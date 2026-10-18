/**
 * Direct calls to the ElevenLabs HTTP API. Every fact in this module was
 * verified against the official documentation:
 *
 * - Text-to-speech: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
 *   with the `output_format` query parameter (e.g. `mp3_44100_128`), a JSON body
 *   of `{ text, model_id }` and a binary audio file as the 200 response.
 *   https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 * - Authentication: every request carries the API key in the `xi-api-key`
 *   header. https://elevenlabs.io/docs/api-reference/authentication
 * - Account test: `GET https://api.elevenlabs.io/v1/user/subscription` returns
 *   the subscription (tier, status, character counts) as JSON.
 *   https://elevenlabs.io/docs/api-reference/user/subscription/get
 * - Voice listing: `GET https://api.elevenlabs.io/v1/voices` returns
 *   `{ voices: [{ voice_id, name, ... }] }`.
 *   https://elevenlabs.io/docs/api-reference/legacy/voices/get-all
 *
 * None of these functions ever throw and none of them may ever place the API
 * key into a message: failures return the real HTTP status plus a short,
 * scrubbed excerpt of the response body.
 */

const API_BASE = 'https://api.elevenlabs.io'
/** Free-tier-safe MP3 format; documented default of the convert endpoint. */
const OUTPUT_FORMAT = 'mp3_44100_128'
const DEFAULT_MIME_TYPE = 'audio/mpeg'
const BODY_EXCERPT_LIMIT = 200
const MAX_VOICES = 50

export interface TtsContext {
  fetchImpl: typeof fetch
  apiKey: string | null
  timeoutMs: number
}

export interface SynthesisResult {
  ok: boolean
  audio?: ArrayBuffer
  mimeType: string
  message?: string
  status?: number
}

export interface VoiceSummary {
  id: string
  name: string
}

interface TimeoutHandle {
  signal: AbortSignal
  clear: () => void
}

/** Synthesize speech with the real ElevenLabs convert endpoint. */
export async function synthesize(
  args: { text: string; voiceId: string; modelId: string },
  ctx: TtsContext
): Promise<SynthesisResult> {
  const { voiceId, modelId } = args
  const text = args.text.trim()
  try {
    if (!text) {
      return { ok: false, mimeType: '', message: 'Nothing to synthesize: the text is empty.' }
    }
    if (!ctx.apiKey) {
      return { ok: false, mimeType: '', message: 'ElevenLabs API key is not configured.' }
    }
    if (!voiceId) {
      return { ok: false, mimeType: '', message: 'No ElevenLabs voice is selected.' }
    }
    const apiKey = ctx.apiKey
    const timeout = startTimeout(ctx.timeoutMs)
    try {
      const response = await ctx.fetchImpl(
        `${API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: DEFAULT_MIME_TYPE
          },
          body: JSON.stringify({ text, model_id: modelId }),
          signal: timeout.signal
        }
      )
      if (!response.ok) {
        return {
          ok: false,
          mimeType: '',
          status: response.status,
          message: await failureMessage('synthesis', response, apiKey)
        }
      }
      const audio = await response.arrayBuffer()
      if (audio.byteLength === 0) {
        return {
          ok: false,
          mimeType: '',
          status: response.status,
          message: 'ElevenLabs returned an empty audio response.'
        }
      }
      return { ok: true, audio, mimeType: resolveMimeType(response) }
    } finally {
      timeout.clear()
    }
  } catch (error) {
    return { ok: false, mimeType: '', message: describeRequestFailure(error, ctx.apiKey) }
  }
}

/**
 * Honest connection test against the real subscription endpoint. Returns what
 * the API actually reported — never a fabricated success.
 */
export async function checkAccount(
  ctx: TtsContext
): Promise<{ ok: boolean; message: string; status?: number }> {
  try {
    if (!ctx.apiKey) {
      return { ok: false, message: 'ElevenLabs API key is not configured.' }
    }
    const apiKey = ctx.apiKey
    const timeout = startTimeout(ctx.timeoutMs)
    try {
      const response = await ctx.fetchImpl(`${API_BASE}/v1/user/subscription`, {
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: timeout.signal
      })
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: await failureMessage('account check', response, apiKey)
        }
      }
      return { ok: true, message: await describeSubscription(response) }
    } finally {
      timeout.clear()
    }
  } catch (error) {
    return { ok: false, message: describeRequestFailure(error, ctx.apiKey) }
  }
}

/** List the account's voices, bounded to the first {@link MAX_VOICES}. */
export async function listVoices(
  ctx: TtsContext
): Promise<{ ok: boolean; voices: VoiceSummary[]; message: string }> {
  try {
    if (!ctx.apiKey) {
      return { ok: false, voices: [], message: 'ElevenLabs API key is not configured.' }
    }
    const apiKey = ctx.apiKey
    const timeout = startTimeout(ctx.timeoutMs)
    try {
      const response = await ctx.fetchImpl(`${API_BASE}/v1/voices`, {
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: timeout.signal
      })
      if (!response.ok) {
        return {
          ok: false,
          voices: [],
          message: await failureMessage('voice listing', response, apiKey)
        }
      }
      const parsed = parseVoiceList(await response.json())
      if (!parsed) {
        return { ok: false, voices: [], message: 'Unexpected response from the voices endpoint.' }
      }
      const message =
        parsed.total > MAX_VOICES
          ? `${parsed.voices.length} of ${parsed.total} voices listed.`
          : `${parsed.voices.length} voices available.`
      return { ok: true, voices: parsed.voices, message }
    } finally {
      timeout.clear()
    }
  } catch (error) {
    return { ok: false, voices: [], message: describeRequestFailure(error, ctx.apiKey) }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function startTimeout(timeoutMs: number): TimeoutHandle {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/** `HTTP <status>` plus at most 200 characters of the response body, scrubbed. */
async function failureMessage(
  action: string,
  response: Response,
  apiKey: string
): Promise<string> {
  const excerpt = await readExcerpt(response, apiKey)
  const headline = `ElevenLabs ${action} failed (HTTP ${response.status})`
  return excerpt ? `${headline}: ${excerpt}` : `${headline}.`
}

async function readExcerpt(response: Response, apiKey: string): Promise<string> {
  try {
    const raw = await response.text()
    return scrub(raw.replace(/\s+/g, ' ').trim(), apiKey)
  } catch {
    return ''
  }
}

function describeRequestFailure(error: unknown, apiKey: string | null): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'ElevenLabs request timed out or was aborted.'
  }
  const detail = error instanceof Error ? error.message : String(error)
  const scrubbed = scrub(detail.replace(/\s+/g, ' ').trim(), apiKey).slice(0, BODY_EXCERPT_LIMIT)
  return scrubbed ? `ElevenLabs request failed: ${scrubbed}` : 'ElevenLabs request failed.'
}

/** Remove the API key from anything user-visible and bound the length. */
function scrub(value: string, secret: string | null): string {
  let output = value
  if (secret && secret.length >= 4) {
    output = output.split(secret).join('<redacted>')
  }
  return output.slice(0, BODY_EXCERPT_LIMIT)
}

function resolveMimeType(response: Response): string {
  const declared = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  return declared.startsWith('audio/') ? declared : DEFAULT_MIME_TYPE
}

async function describeSubscription(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (isRecord(data)) {
      const parts: string[] = []
      if (typeof data.tier === 'string' && data.tier) parts.push(`tier ${data.tier}`)
      if (typeof data.status === 'string' && data.status) parts.push(`status ${data.status}`)
      if (parts.length > 0) return `Connected to ElevenLabs (${parts.join(', ')}).`
    }
  } catch {
    /* fall through to the generic, still-honest message */
  }
  return 'Connected to ElevenLabs.'
}

function parseVoiceList(payload: unknown): { voices: VoiceSummary[]; total: number } | null {
  if (!isRecord(payload)) return null
  const raw: unknown = payload.voices
  if (!Array.isArray(raw)) return null
  const list: unknown[] = raw
  const voices: VoiceSummary[] = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const voiceId = entry.voice_id
    const name = entry.name
    if (typeof voiceId !== 'string' || voiceId.length === 0) continue
    voices.push({
      id: voiceId,
      name: typeof name === 'string' && name.length > 0 ? name : voiceId
    })
    if (voices.length >= MAX_VOICES) break
  }
  return { voices, total: list.length }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
