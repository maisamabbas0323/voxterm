import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STT_MODEL,
  ELEVENLABS_STT_ENDPOINT,
  transcribeWithElevenLabs,
  type SttContext,
  type SttRequest
} from '../src/main/voice/elevenlabsStt'

/**
 * ElevenLabs speech-to-text tests. Every request below happens against a fake
 * `fetch`, so the assertions are about VoxTerm's own behaviour: the exact
 * HTTP shape the endpoint receives (multipart body, xi-api-key header, no
 * language_code for auto-detection), the pre-flight refusals that must never
 * touch the network, structured (never thrown) failures including timeouts,
 * and the guarantee that the stored API key never appears in a message.
 */

/** Deliberately recognisable secret, echoed back by failing fake servers. */
const API_KEY = 'el-LEAKED-KEY-123456789'

interface RecordedCall {
  url: string
  init: RequestInit | undefined
}

function createFakeFetch(handler: (call: RecordedCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImpl = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit
  ): Promise<Response> => {
    const call: RecordedCall = {
      url:
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      init
    }
    calls.push(call)
    return handler(call)
  }
  return { fetchImpl, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

/** The single request the client made, or a thrown diagnostic. */
function mustCall(calls: RecordedCall[]): RecordedCall {
  const [call] = calls
  if (call === undefined) throw new Error('expected a request to have been made')
  return call
}

function headersOf(call: RecordedCall): Record<string, string> {
  const headers = call.init?.headers
  if (headers === null || headers === undefined) return {}
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers as Record<string, string>
}

function bodyOf(call: RecordedCall): FormData {
  const body = call.init?.body
  if (!(body instanceof FormData)) throw new Error('expected a FormData request body')
  return body
}

function makeRequest(overrides: Partial<SttRequest> = {}): SttRequest {
  return {
    wav: new Uint8Array([1, 2, 3, 4]),
    durationMs: 2_000,
    language: 'auto',
    minDurationMs: 700,
    ...overrides
  }
}

function makeContext(fetchImpl: typeof fetch, overrides: Partial<SttContext> = {}): SttContext {
  return { apiKey: API_KEY, modelId: DEFAULT_STT_MODEL, fetchImpl, ...overrides }
}

// ---------------------------------------------------------------------------
// Pre-flight refusals (no network call may happen)
// ---------------------------------------------------------------------------

describe('transcribeWithElevenLabs pre-flight refusals', () => {
  it('refuses without an API key and never touches the network', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ text: 'must not happen' }))

    const outcome = await transcribeWithElevenLabs(
      makeRequest(),
      makeContext(fetchImpl, { apiKey: '' })
    )

    expect(outcome).toMatchObject({
      ok: false,
      text: '',
      language: null,
      code: 'disabled',
      message: 'No ElevenLabs API key is configured.'
    })
    expect(calls).toHaveLength(0)
  })

  it('refuses empty wav bytes as invalid audio', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ text: 'must not happen' }))

    const outcome = await transcribeWithElevenLabs(
      makeRequest({ wav: new Uint8Array(0) }),
      makeContext(fetchImpl)
    )

    expect(outcome).toMatchObject({
      ok: false,
      code: 'invalid-audio',
      message: 'The recording contained no audio.'
    })
    expect(calls).toHaveLength(0)
  })

  it('refuses a recording shorter than the configured minimum duration', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ text: 'must not happen' }))

    const outcome = await transcribeWithElevenLabs(
      makeRequest({ durationMs: 250, minDurationMs: 700 }),
      makeContext(fetchImpl)
    )

    expect(outcome).toMatchObject({
      ok: false,
      code: 'too-short',
      message: 'The recording was too short to transcribe.'
    })
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Successful transcription and request shape
// ---------------------------------------------------------------------------

describe('transcribeWithElevenLabs requests', () => {
  it('posts multipart audio with the xi-api-key header and returns the trimmed transcript', async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ text: '  add a retry flag to fetch.ts  ', language_code: 'en' })
    )

    const outcome = await transcribeWithElevenLabs(
      makeRequest({ language: 'en' }),
      makeContext(fetchImpl)
    )

    expect(outcome).toMatchObject({
      ok: true,
      text: 'add a retry flag to fetch.ts',
      language: 'en',
      message: 'Transcribed with ElevenLabs.'
    })
    expect(outcome.code).toBeUndefined()

    const call = mustCall(calls)
    expect(call.url).toBe(ELEVENLABS_STT_ENDPOINT)
    expect(call.init?.method).toBe('POST')
    expect(headersOf(call)['xi-api-key']).toBe(API_KEY)

    const body = bodyOf(call)
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('model_id')).toBe(DEFAULT_STT_MODEL)
    expect(body.get('file')).not.toBeNull()
  })

  it('omits language_code for "auto" and empty language, and sends it for a real code', async () => {
    const cases: Array<{ language: string; expected: string | null }> = [
      { language: 'auto', expected: null },
      { language: 'AUTO', expected: null },
      { language: '', expected: null },
      { language: 'en', expected: 'en' },
      { language: 'de', expected: 'de' }
    ]
    for (const { language, expected } of cases) {
      const { fetchImpl, calls } = createFakeFetch(() =>
        jsonResponse(expected === null ? { text: 'ok' } : { text: 'ok', language_code: expected })
      )

      const outcome = await transcribeWithElevenLabs(makeRequest({ language }), makeContext(fetchImpl))

      expect(outcome.ok).toBe(true)
      expect(outcome.language).toBe(expected)
      const body = bodyOf(mustCall(calls))
      expect(body.get('language_code')).toBe(expected)
      if (expected === null) expect(body.getAll('language_code')).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Failures: HTTP errors, malformed bodies, network errors, timeouts
// ---------------------------------------------------------------------------

describe('transcribeWithElevenLabs failures', () => {
  it('reports a rejected API key on 401/403 without echoing the key', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = createFakeFetch(
        () => new Response(JSON.stringify({ detail: `invalid api key ${API_KEY}` }), { status })
      )

      const outcome = await transcribeWithElevenLabs(makeRequest(), makeContext(fetchImpl))

      expect(outcome.ok).toBe(false)
      expect(outcome.code).toBe('failed')
      expect(outcome.message).toContain('rejected the API key')
      expect(outcome.message).not.toContain(API_KEY)
      expect(outcome.message).not.toContain('LEAKED')
    }
  })

  it('mentions the HTTP status for other failures without echoing the key', async () => {
    for (const status of [413, 429, 500, 503]) {
      const { fetchImpl } = createFakeFetch(
        () => new Response(JSON.stringify({ detail: `upstream ${API_KEY} broke` }), { status })
      )

      const outcome = await transcribeWithElevenLabs(makeRequest(), makeContext(fetchImpl))

      expect(outcome.ok).toBe(false)
      expect(outcome.code).toBe('failed')
      expect(outcome.message).toContain(`HTTP ${status}`)
      expect(outcome.message).not.toContain(API_KEY)
      expect(outcome.message).not.toContain('LEAKED')
    }
  })

  it('rejects a response body that is not valid JSON', async () => {
    const { fetchImpl } = createFakeFetch(() => new Response('<<<not json>>>', { status: 200 }))

    const outcome = await transcribeWithElevenLabs(makeRequest(), makeContext(fetchImpl))

    expect(outcome).toMatchObject({
      ok: false,
      code: 'failed',
      message: 'ElevenLabs returned a response that is not valid JSON.'
    })
  })

  it('reports an empty transcript as empty', async () => {
    const { fetchImpl } = createFakeFetch(() => jsonResponse({ text: '' }))

    const outcome = await transcribeWithElevenLabs(makeRequest(), makeContext(fetchImpl))

    expect(outcome).toMatchObject({
      ok: false,
      text: '',
      language: null,
      code: 'empty',
      message: 'No speech was detected.'
    })
  })

  it('returns a failed outcome (never throws) when fetch rejects, without the key', async () => {
    const { fetchImpl } = createFakeFetch(() => {
      throw new Error(`connect ECONNREFUSED while using key ${API_KEY}`)
    })

    const outcome = await transcribeWithElevenLabs(makeRequest(), makeContext(fetchImpl))

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('failed')
    expect(outcome.message).toContain('ElevenLabs request failed')
    expect(outcome.message).not.toContain(API_KEY)
    expect(outcome.message).not.toContain('LEAKED')
  })

  it('times out a hung request via the injected timeout', async () => {
    // A server that never answers; it only rejects when the client aborts.
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined) return
        signal.addEventListener('abort', () => {
          const error = new Error('This operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })

    const outcome = await transcribeWithElevenLabs(
      makeRequest(),
      makeContext(fetchImpl, { timeoutMs: 5 })
    )

    expect(outcome).toMatchObject({
      ok: false,
      code: 'timeout',
      message: 'The transcription request timed out.'
    })
  })
})
