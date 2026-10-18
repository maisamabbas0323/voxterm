/**
 * Orchestrates spoken announcements: gate on settings, de-duplicate, queue,
 * synthesize through ElevenLabs, then hand the encoded audio to the renderer.
 *
 * Privacy rules enforced here:
 * - Announcement text (which may contain terminal output) never reaches the
 *   activity log, the file log, or any error message.
 * - The API key never reaches a message, a log line or an activity detail.
 */
import { randomUUID } from 'node:crypto'
import type { AnnouncementAudioPayload } from '@shared/api'
import type { Settings } from '@shared/schemas'
import type { AnnouncementStatus } from '@shared/types'
import type { Logger } from '../util/logger'
import { envValue } from '../settings/envSecrets'
import { synthesize, type SynthesisResult, type TtsContext } from './tts'

export type AnnouncementCategory = Settings['announcements']['eventCategories'][number]

export interface AnnouncementDeps {
  getSettings: () => Settings
  getSecret: (slot: 'elevenlabs') => string | null
  logger: Logger
  record: (event: {
    category: 'voice'
    type: string
    message: string
    level: 'info' | 'success' | 'warn' | 'error'
    details?: Record<string, string | number | boolean | null>
  }) => void
  deliver: (payload: AnnouncementAudioPayload) => void
  fetchImpl?: typeof fetch
}

/** Identical announcements inside this window are dropped. */
const DUPLICATE_WINDOW_MS = 10_000
/** Pending items beyond this are dropped, oldest first. */
const MAX_QUEUE = 3
const REQUEST_TIMEOUT_MS = 20_000
const TEST_TEXT = 'VoxTerm announcement test.'

interface QueueItem {
  id: string
  category: AnnouncementCategory
  text: string
}

export class AnnouncementService {
  private queue: QueueItem[] = []
  private playing = false
  private lastError: string | null = null
  /** `category + separator + text` → enqueue time, for duplicate suppression. */
  private recent = new Map<string, number>()
  private drainPromise: Promise<void> | null = null

  constructor(private readonly deps: AnnouncementDeps) {}

  /**
   * The voice to speak with: the value chosen in Settings, or the one supplied
   * through the environment (`VOXTERM_ELEVENLABS_VOICE_ID`) as a fallback so a
   * configured `.env` works without pasting the id into the UI.
   */
  private voiceId(): string {
    const configured = this.deps.getSettings().announcements.voiceId.trim()
    return configured || envValue('VOXTERM_ELEVENLABS_VOICE_ID') || ''
  }

  private modelId(): string {
    const configured = this.deps.getSettings().announcements.modelId.trim()
    if (configured.length > 0) return configured
    return envValue('VOXTERM_ELEVENLABS_MODEL') || 'eleven_multilingual_v2'
  }

  status(): AnnouncementStatus {
    const config = this.deps.getSettings().announcements
    const apiKey = this.deps.getSecret('elevenlabs')
    const voiceId = this.voiceId()
    return {
      enabled: config.enabled,
      muted: config.muted,
      configured: Boolean(apiKey) && voiceId.length > 0,
      voiceId: voiceId.length > 0 ? voiceId : null,
      modelId: this.modelId(),
      playing: this.playing,
      queued: this.queue.length,
      lastError: this.lastError
    }
  }

  /**
   * Queue an announcement unless announcements are disabled, muted, the
   * category is not selected, the key or voice is missing, the text is empty,
   * the same announcement fired recently, or the queue is full (oldest first).
   */
  async announce(category: AnnouncementCategory, text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return

    const config = this.deps.getSettings().announcements
    if (!config.enabled || config.muted) return
    if (!config.eventCategories.includes(category)) return
    if (!this.deps.getSecret('elevenlabs') || this.voiceId().length === 0) return
    if (this.isDuplicate(category, trimmed)) return

    while (this.queue.length >= MAX_QUEUE) this.queue.shift()
    this.queue.push({ id: randomUUID(), category, text: trimmed })
    await this.ensureDraining()
  }

  /**
   * Real synthesis of a fixed sentence with the configured voice, delivered to
   * the renderer for playback. Returns the actual outcome — and must not call
   * the API at all when the key or the voice is missing.
   */
  async test(): Promise<{ ok: boolean; message: string }> {
    const apiKey = this.deps.getSecret('elevenlabs')
    const voiceId = this.voiceId()
    if (!apiKey) {
      return { ok: false, message: 'ElevenLabs API key is not configured. Add it in Settings.' }
    }
    if (voiceId.length === 0) {
      return { ok: false, message: 'No announcement voice is selected. Choose one in Settings.' }
    }

    const result = await synthesize(
      { text: TEST_TEXT, voiceId, modelId: this.modelId() },
      this.context(apiKey)
    )
    if (!result.ok || !result.audio) {
      const message = result.message ?? 'Synthesis failed.'
      this.lastError = message
      this.deps.logger.warn('announcements', `Test synthesis failed: ${message}`)
      this.deps.record({
        category: 'voice',
        type: 'announcement.test-failed',
        message: 'Announcement test failed',
        level: 'error',
        details: { httpStatus: result.status ?? null }
      })
      return { ok: false, message }
    }

    this.lastError = null
    this.deliver({ id: randomUUID(), category: 'test', result })
    this.deps.record({
      category: 'voice',
      type: 'announcement.test',
      message: 'Announcement test played',
      level: 'success',
      details: { mimeType: result.mimeType, bytes: result.audio.byteLength }
    })
    return { ok: true, message: 'Synthesis succeeded — playing the test announcement.' }
  }

  /** Drop every pending announcement and report idle. */
  dispose(): void {
    this.queue = []
    this.playing = false
  }

  // -------------------------------------------------------------------------
  // Queue internals
  // -------------------------------------------------------------------------

  private isDuplicate(category: AnnouncementCategory, text: string): boolean {
    const now = Date.now()
    for (const [key, at] of this.recent) {
      if (now - at >= DUPLICATE_WINDOW_MS) this.recent.delete(key)
    }
    const key = `${category}|${text}`
    if (this.recent.has(key)) return true
    this.recent.set(key, now)
    return false
  }

  private ensureDraining(): Promise<void> {
    if (!this.drainPromise) {
      this.drainPromise = this.drainQueue().finally(() => {
        this.drainPromise = null
      })
    }
    return this.drainPromise
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break
      this.playing = true
      try {
        await this.processItem(item)
      } catch (error) {
        // A broken renderer or unexpected fault must never reject announce().
        const detail = error instanceof Error ? error.message : String(error)
        this.lastError = `Announcement playback failed: ${detail.slice(0, 200)}`
        this.deps.logger.warn('announcements', this.lastError)
      } finally {
        this.playing = false
      }
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    const config = this.deps.getSettings().announcements
    const apiKey = this.deps.getSecret('elevenlabs')
    const voiceId = this.voiceId()
    // Settings can change while an item waits; respect the current state.
    if (!config.enabled || config.muted || !apiKey || voiceId.length === 0) return

    const result = await synthesize(
      { text: item.text, voiceId, modelId: this.modelId() },
      this.context(apiKey)
    )
    if (!result.ok || !result.audio) {
      this.reportFailure(item.category, result)
      return
    }
    this.lastError = null
    this.deliver({ id: item.id, category: item.category, result })
    this.deps.record({
      category: 'voice',
      type: 'announcement.played',
      message: `Announcement played (${item.category})`,
      level: 'success',
      details: {
        category: item.category,
        mimeType: result.mimeType,
        bytes: result.audio.byteLength
      }
    })
  }

  private reportFailure(category: AnnouncementCategory, result: SynthesisResult): void {
    const message = result.message ?? 'Synthesis failed.'
    this.lastError = message
    this.deps.logger.warn('announcements', `Announcement failed: ${message}`)
    this.deps.record({
      category: 'voice',
      type: 'announcement.failed',
      message: `Announcement failed (${category})`,
      level: 'error',
      details: { category, httpStatus: result.status ?? null }
    })
  }

  private deliver(input: { id: string; category: string; result: SynthesisResult }): void {
    if (!input.result.audio) return
    this.deps.deliver({
      id: input.id,
      category: input.category,
      mimeType: input.result.mimeType,
      dataBase64: Buffer.from(input.result.audio).toString('base64')
    })
  }

  private context(apiKey: string): TtsContext {
    return {
      fetchImpl: this.deps.fetchImpl ?? globalThis.fetch,
      apiKey,
      timeoutMs: REQUEST_TIMEOUT_MS
    }
  }
}
