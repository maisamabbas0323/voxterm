import type { MicrophoneAccessResult } from '@shared/api'
import { IPC_EVENTS } from '@shared/ipc'
import type {
  SttRuntimeInfo,
  TranscribeErrorCode,
  TranscribeResult,
  VoiceHotkeyMode,
  VoiceRecordingMode,
  VoiceStatus
} from '@shared/types'
import type { ActivityLog } from '../activity/log'
import type { SettingsStore } from '../settings/store'
import type { Logger } from '../util/logger'
import { VoiceHotkey, type HotkeySignal } from './hotkey'
import { DEFAULT_STT_MODEL, transcribeWithElevenLabs } from './elevenlabsStt'

export interface VoiceControllerDeps {
  settings: SettingsStore
  logger: Logger
  activity: ActivityLog
  /** Read the stored (or environment) ElevenLabs key. Main-process only. */
  getSecret: (slot: 'elevenlabs') => string | null
  /** Send a main -> renderer event to every window. */
  broadcast: (channel: string, payload: unknown) => void
  /** Electron's globalShortcut, injected so this stays testable. */
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => boolean
    unregister: (accelerator: string) => void
  } | null
  /** Read the OS microphone permission; injected for testability. */
  getMediaAccessStatus?: (mediaType: 'microphone') => MicrophonePermissionLike
  /** Ask the OS for microphone access (macOS prompt). null when unsupported. */
  requestOsAccess?: () => Promise<boolean | null>
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

type MicrophonePermissionLike = 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-determined'

const HOTKEY_CHANNEL = IPC_EVENTS.voiceHotkeyPressed
const STATUS_CHANNEL = IPC_EVENTS.voiceStatusChanged

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Main-process voice orchestration.
 *
 * Audio capture and microphone access happen in the renderer (only
 * `getUserMedia` can reach the microphone). This controller owns everything
 * around it: the push-to-talk hotkey, the recording state machine, microphone
 * permission bookkeeping and the ElevenLabs speech-to-text call. Speech is
 * transcribed in the cloud and requires a configured ElevenLabs key.
 */
export class VoiceController {
  private recordingMode: VoiceRecordingMode = 'idle'
  private hotkey: VoiceHotkey
  private hotkeyRegistered = false
  private hotkeyMode: VoiceHotkeyMode = 'unavailable'
  private hotkeyError: string | null = null
  private hotkeyShortcut = ''
  private microphonePermission: MicrophonePermissionLike = 'unknown'
  private abort: AbortController | null = null

  constructor(private readonly deps: VoiceControllerDeps) {
    this.hotkey = new VoiceHotkey(
      (signal) => this.onHotkeySignal(signal),
      deps.logger,
      deps.globalShortcut
    )
    try {
      this.microphonePermission = deps.getMediaAccessStatus?.('microphone') ?? 'unknown'
    } catch {
      this.microphonePermission = 'unknown'
    }
  }

  /** Apply the hotkey preference. */
  async bootstrap(): Promise<void> {
    this.applyHotkey()
    this.emitStatus()
  }

  /** The current speech-to-text readiness, derived from the stored key. */
  private stt(): SttRuntimeInfo {
    const settings = this.deps.settings.get()
    const configured = Boolean(this.deps.getSecret('elevenlabs'))
    const modelId = settings.voice.sttModelId.trim() || DEFAULT_STT_MODEL
    return {
      provider: 'elevenlabs',
      configured,
      modelId,
      detail: configured
        ? `ElevenLabs speech-to-text (${modelId}) is ready.`
        : 'No ElevenLabs API key is configured. Add one in Settings → System & credentials or in .env.'
    }
  }

  /** React to a settings change: the hotkey follows the enabled flag. */
  applySettings(): void {
    this.applyHotkey()
    this.emitStatus()
  }

  private applyHotkey(): void {
    const settings = this.deps.settings.get()
    const enabled = settings.voice.enabled
    const chord = settings.voice.hotkey
    if (!enabled) {
      this.hotkey.unregister()
      this.hotkeyRegistered = false
      this.hotkeyMode = 'unavailable'
      this.hotkeyError = null
      this.hotkeyShortcut = chord
      return
    }
    const result = this.hotkey.register(chord, settings.voice.pushToTalk)
    this.hotkeyRegistered = result.registered
    this.hotkeyMode = result.mode
    this.hotkeyError = result.error
    this.hotkeyShortcut = chord
  }

  private onHotkeySignal(signal: HotkeySignal): void {
    const settings = this.deps.settings.get()
    if (!settings.voice.enabled) return
    if (signal === 'toggle') {
      // Toggle mode has no key-up event, so flip based on the real state.
      const pressed = this.recordingMode !== 'recording'
      this.deps.broadcast(HOTKEY_CHANNEL, { pressed })
      return
    }
    this.deps.broadcast(HOTKEY_CHANNEL, { pressed: signal === 'down' })
  }

  get status(): VoiceStatus {
    return {
      enabled: this.deps.settings.get().voice.enabled,
      recordingMode: this.recordingMode,
      hotkey: {
        registered: this.hotkeyRegistered,
        mode: this.hotkeyMode,
        shortcut: this.hotkeyShortcut || this.deps.settings.get().voice.hotkey,
        error: this.hotkeyError
      },
      microphonePermission: this.mapPermission(this.microphonePermission),
      stt: this.stt()
    }
  }

  private mapPermission(value: MicrophonePermissionLike): VoiceStatus['microphonePermission'] {
    switch (value) {
      case 'granted':
        return 'granted'
      case 'denied':
      case 'restricted':
        return 'denied'
      case 'not-determined':
        return 'prompt'
      default:
        return 'unknown'
    }
  }

  /**
   * Permission bookkeeping. The renderer always calls this before capture: with
   * no `outcome` it asks whether capture is permitted and reports the known OS
   * status; with an `outcome` it records what `getUserMedia` actually returned.
   */
  async microphoneAccess(outcome?: 'granted' | 'denied'): Promise<MicrophoneAccessResult> {
    if (outcome) {
      this.microphonePermission = outcome === 'granted' ? 'granted' : 'denied'
      if (outcome === 'denied') {
        this.deps.activity.record({
          category: 'voice',
          type: 'voice.microphone-denied',
          message: 'Microphone access was denied',
          level: 'warn'
        })
      }
      this.emitStatus()
      return { allowed: outcome === 'granted', permission: this.mapPermission(this.microphonePermission) }
    }

    const enabled = this.deps.settings.get().voice.enabled
    if (!enabled) {
      return {
        allowed: false,
        permission: this.mapPermission(this.microphonePermission),
        message: 'Voice input is turned off in Settings → Voice.'
      }
    }

    // macOS gates the microphone with a real OS prompt; trigger it the first
    // time the renderer asks to capture.
    if (this.deps.requestOsAccess && this.microphonePermission !== 'granted') {
      const granted = await this.deps.requestOsAccess()
      if (granted !== null) {
        this.microphonePermission = granted ? 'granted' : 'denied'
        this.emitStatus()
        if (!granted) {
          return {
            allowed: false,
            permission: this.mapPermission(this.microphonePermission),
            message: 'Microphone access was denied in the operating system privacy settings.'
          }
        }
      }
    }

    return { allowed: true, permission: this.mapPermission(this.microphonePermission) }
  }

  /** Called by the renderer once it has a live microphone stream. */
  begin(source: 'manual' | 'hotkey'): { ok: boolean; message?: string; code?: string } {
    const settings = this.deps.settings.get()
    if (!settings.voice.enabled) return { ok: false, code: 'disabled', message: 'Voice input is turned off.' }
    if (!this.deps.getSecret('elevenlabs')) {
      return {
        ok: false,
        code: 'not-configured',
        message: 'Add an ElevenLabs API key in Settings → System & credentials to transcribe speech.'
      }
    }
    if (this.recordingMode === 'recording') return { ok: true }
    if (this.recordingMode === 'transcribing') {
      return { ok: false, code: 'busy', message: 'Still transcribing the previous recording.' }
    }
    this.recordingMode = 'recording'
    this.deps.activity.record({
      category: 'voice',
      type: 'voice.recording-started',
      message: source === 'hotkey' ? 'Recording started (hotkey)' : 'Recording started',
      level: 'info',
      details: { source }
    })
    this.emitStatus()
    return { ok: true }
  }

  cancel(): void {
    if (this.abort) {
      this.abort.abort()
      this.abort = null
    }
    if (this.recordingMode === 'recording') {
      this.deps.activity.record({
        category: 'voice',
        type: 'voice.recording-cancelled',
        message: 'Recording discarded',
        level: 'info'
      })
    }
    this.recordingMode = 'idle'
    this.emitStatus()
  }

  /** Transcribe a finished recording through ElevenLabs. */
  async finish(options: { wav: Buffer; durationMs: number }): Promise<TranscribeResult> {
    const settings = this.deps.settings.get()
    const audioMs = options.durationMs
    const empty = (code: TranscribeErrorCode, error: string, inferenceMs = 0): TranscribeResult => ({
      ok: false,
      text: '',
      language: null,
      confidence: null,
      audioMs,
      inferenceMs,
      code,
      error
    })

    if (this.recordingMode === 'transcribing') {
      return empty('busy', 'A transcription is already running.')
    }

    const apiKey = this.deps.getSecret('elevenlabs')
    if (!apiKey) {
      this.recordingMode = 'idle'
      this.emitStatus()
      return empty('not-configured', 'No ElevenLabs API key is configured.')
    }

    this.recordingMode = 'transcribing'
    this.emitStatus()
    const startedAt = Date.now()

    try {
      const outcome = await transcribeWithElevenLabs(
        {
          wav: options.wav,
          durationMs: audioMs,
          language: settings.voice.language,
          minDurationMs: settings.voice.minRecordingMs
        },
        {
          apiKey,
          modelId: settings.voice.sttModelId,
          ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {})
        }
      )
      const inferenceMs = Date.now() - startedAt

      this.recordingMode = 'idle'
      this.emitStatus()

      // Activity records the outcome and size, never the transcript text.
      this.deps.activity.record({
        category: 'voice',
        type: outcome.ok ? 'voice.transcribed' : 'voice.transcription-failed',
        message: outcome.ok
          ? `Transcribed ${Math.round(audioMs / 1000)}s of audio${outcome.language ? ` (${outcome.language})` : ''}`
          : `Transcription failed: ${outcome.message}`,
        level: outcome.ok ? 'success' : 'warn',
        details: {
          audioMs,
          inferenceMs,
          characters: outcome.text.length,
          code: outcome.code ?? null
        }
      })

      return {
        ok: outcome.ok,
        text: outcome.text,
        language: outcome.language,
        confidence: null,
        audioMs,
        inferenceMs,
        ...(outcome.ok ? {} : { code: outcome.code ?? 'failed', error: outcome.message })
      }
    } catch (error) {
      this.recordingMode = 'idle'
      this.emitStatus()
      const text = message(error)
      this.deps.logger.warn('voice', `Transcription crashed: ${text}`)
      return empty('failed', text, Date.now() - startedAt)
    }
  }

  private emitStatus(): void {
    this.deps.broadcast(STATUS_CHANNEL, this.status)
  }

  dispose(): void {
    this.abort?.abort()
    this.abort = null
    this.hotkey.dispose()
    this.recordingMode = 'idle'
  }
}
