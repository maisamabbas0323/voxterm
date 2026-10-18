/**
 * ElevenLabs speech-to-text client.
 *
 * Audio captured in the renderer (16 kHz mono WAV) is posted to the ElevenLabs
 * speech-to-text endpoint as multipart/form-data and the transcript is returned
 * to the caller. Every failure is reported honestly and the API key is never
 * echoed into a message, a log line or the activity log.
 *
 * Endpoint facts (verified against the ElevenLabs documentation):
 * - `POST https://api.elevenlabs.io/v1/speech-to-text`
 * - Authentication is the `xi-api-key` header.
 * - Multipart fields: `file` (the audio) and `model_id` (e.g. `scribe_v1`);
 *   `language_code` is optional (omit it to auto-detect).
 * - A success response is `{ text, language_code?, words? }`.
 *
 * https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */

export const ELEVENLABS_STT_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'
export const DEFAULT_STT_MODEL = 'scribe_v1'

const REQUEST_TIMEOUT_MS = 60_000
/** Beyond this we refuse rather than burn a huge upload. */
const MAX_AUDIO_BYTES = 40 * 1024 * 1024

export type SttErrorCode =
  | 'disabled'
  | 'invalid-audio'
  | 'too-short'
  | 'empty'
  | 'timeout'
  | 'failed'

export interface SttRequest {
  wav: Uint8Array
  durationMs: number
  /** ISO-639 code, or "auto"/empty to let the service detect it. */
  language: string
  /** Recordings shorter than this are refused before any network call. */
  minDurationMs: number
}

export interface SttContext {
  apiKey: string
  modelId: string
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface SttOutcome {
  ok: boolean
  text: string
  language: string | null
  message: string
  code?: SttErrorCode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep a short, useful excerpt of an error body without leaking the key. */
function scrub(message: string, secret: string): string {
  let result = message
  if (secret && result.includes(secret)) result = result.split(secret).join('***')
  return result.slice(0, 200)
}

function firstMessage(body: string): string {
  const text = body.trim()
  if (text.length === 0) return ''
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) {
      if (typeof parsed.message === 'string') return parsed.message
      if (typeof parsed.error === 'string') return parsed.error
      if (isRecord(parsed.detail) && typeof parsed.detail.message === 'string') {
        return parsed.detail.message
      }
    }
  } catch {
    // Not JSON; fall through to the raw excerpt.
  }
  return text
}

/**
 * Transcribe one recording. Network and service errors are returned as a
 * failed outcome, never thrown, so the caller can surface them to the user.
 */
export async function transcribeWithElevenLabs(
  request: SttRequest,
  context: SttContext
): Promise<SttOutcome> {
  const fail = (code: SttErrorCode, message: string): SttOutcome => ({
    ok: false,
    text: '',
    language: null,
    message,
    code
  })

  if (!context.apiKey) {
    return fail('disabled', 'No ElevenLabs API key is configured.')
  }
  if (request.wav.byteLength === 0) {
    return fail('invalid-audio', 'The recording contained no audio.')
  }
  if (request.wav.byteLength > MAX_AUDIO_BYTES) {
    return fail('invalid-audio', 'The recording was too large to transcribe.')
  }
  if (request.durationMs < request.minDurationMs) {
    return fail('too-short', 'The recording was too short to transcribe.')
  }

  const form = new FormData()
  form.append('model_id', context.modelId.trim() || DEFAULT_STT_MODEL)
  const language = request.language.trim()
  if (language.length > 0 && language.toLowerCase() !== 'auto') {
    form.append('language_code', language)
  }
  form.append('file', new Blob([request.wav], { type: 'audio/wav' }), 'recording.wav')

  const fetchImpl = context.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(ELEVENLABS_STT_ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': context.apiKey, Accept: 'application/json' },
      body: form,
      signal: controller.signal
    })

    const body = await response.text()

    if (!response.ok) {
      const detail = firstMessage(body)
      const hint =
        response.status === 401 || response.status === 403
          ? 'ElevenLabs rejected the API key.'
          : response.status === 422
            ? 'ElevenLabs could not decode the recording.'
            : `ElevenLabs returned HTTP ${response.status}.`
      return fail('failed', detail ? `${hint} ${scrub(detail, context.apiKey)}` : hint)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return fail('failed', 'ElevenLabs returned a response that is not valid JSON.')
    }
    if (!isRecord(parsed) || typeof parsed.text !== 'string') {
      return fail('failed', 'ElevenLabs returned no transcript text.')
    }
    const text = parsed.text.trim()
    if (text.length === 0) {
      return { ok: false, text: '', language: null, message: 'No speech was detected.', code: 'empty' }
    }
    const detected = typeof parsed.language_code === 'string' ? parsed.language_code : null
    return { ok: true, text, language: detected, message: 'Transcribed with ElevenLabs.' }
  } catch (error) {
    if (controller.signal.aborted) {
      return fail('timeout', 'The transcription request timed out.')
    }
    const message = error instanceof Error ? error.message : String(error)
    return fail('failed', `ElevenLabs request failed: ${scrub(message, context.apiKey)}`)
  } finally {
    clearTimeout(timeout)
  }
}
