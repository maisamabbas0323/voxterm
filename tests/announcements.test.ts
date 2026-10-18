import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnouncementAudioPayload } from '@shared/api'
import { DEFAULT_SETTINGS, type Settings } from '@shared/schemas'
import {
  AnnouncementService,
  type AnnouncementDeps
} from '../src/main/announcements/service'
import { checkAccount, listVoices, synthesize, type TtsContext } from '../src/main/announcements/tts'
import { Logger } from '../src/main/util/logger'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type FetchMock = ReturnType<typeof vi.fn<(input: FetchInput, init?: FetchInit) => Promise<Response>>>

interface RecordedEvent {
  category: 'voice'
  type: string
  message: string
  level: 'info' | 'success' | 'warn' | 'error'
  details?: Record<string, string | number | boolean | null>
}

interface Harness {
  service: AnnouncementService
  fetchMock: FetchMock
  delivered: AnnouncementAudioPayload[]
  recorded: RecordedEvent[]
}

interface HarnessOptions {
  settings?: Partial<Settings['announcements']>
  apiKey?: string | null
}

function createFetchMock(): FetchMock {
  const fetchMock = vi.fn<(input: FetchInput, init?: FetchInit) => Promise<Response>>()
  fetchMock.mockImplementation(async () => audioResponse())
  return fetchMock
}

function audioResponse(bytes: number[] = [1, 2, 3]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  })
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Let real macrotasks (and every queued microtask) run; fake timers stay put. */
async function settle(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
}

function createHarness(options: HarnessOptions = {}): Harness {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    announcements: {
      ...DEFAULT_SETTINGS.announcements,
      enabled: true,
      voiceId: 'voice-abc',
      eventCategories: ['session-exit', 'error', 'agent-event'],
      ...options.settings
    }
  }
  const apiKey: string | null = options.apiKey !== undefined ? options.apiKey : 'test-key-123'

  const fetchMock = createFetchMock()
  const delivered: AnnouncementAudioPayload[] = []
  const recorded: RecordedEvent[] = []
  const logger = new Logger({
    directory: join(tmpdir(), 'voxterm-announcements-test'),
    enabled: false,
    redact: true
  })

  const deps: AnnouncementDeps = {
    getSettings: () => settings,
    getSecret: () => apiKey,
    logger,
    record: (event) => {
      recorded.push(event)
    },
    deliver: (payload) => {
      delivered.push(payload)
    },
    fetchImpl: fetchMock
  }

  return {
    service: new AnnouncementService(deps),
    fetchMock,
    delivered,
    recorded
  }
}

function createTtsContext(
  fetchMock: FetchMock,
  apiKey: string | null = 'test-key-123'
): TtsContext {
  return { fetchImpl: fetchMock, apiKey, timeoutMs: 1000 }
}

beforeEach(() => {
  // Only the timers this code creates are faked; setImmediate/queueMicrotask
  // stay real so promise chains and Response bodies always drain.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AnnouncementService gating', () => {
  it('does not call the API when announcements are disabled', async () => {
    const harness = createHarness({ settings: { enabled: false } })
    await harness.service.announce('error', 'Build failed')
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.delivered).toHaveLength(0)
  })

  it('does not call the API while muted', async () => {
    const harness = createHarness({ settings: { muted: true } })
    await harness.service.announce('error', 'Build failed')
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.delivered).toHaveLength(0)
  })

  it('does not call the API for a category that is not selected', async () => {
    const harness = createHarness({ settings: { eventCategories: ['error'] } })
    await harness.service.announce('session-exit', 'Session finished')
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.delivered).toHaveLength(0)
  })

  it('does not call the API without an API key and test() says so honestly', async () => {
    const harness = createHarness({ apiKey: null })
    await harness.service.announce('error', 'Build failed')
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.service.status().configured).toBe(false)

    const result = await harness.service.test()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/API key/i)
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.delivered).toHaveLength(0)
  })

  it('does not call the API without a voice id and test() says so honestly', async () => {
    const harness = createHarness({ settings: { voiceId: '' } })
    await harness.service.announce('error', 'Build failed')
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(harness.service.status().configured).toBe(false)

    const result = await harness.service.test()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/voice/i)
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })

  it('ignores empty announcement text', async () => {
    const harness = createHarness()
    await harness.service.announce('error', '   ')
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })
})

describe('AnnouncementService playback', () => {
  it('delivers base64 audio exactly once on the successful path', async () => {
    const harness = createHarness()
    harness.fetchMock.mockImplementation(async () => audioResponse([9, 8, 7]))

    await harness.service.announce('session-exit', 'Session finished')

    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]).toMatchObject({
      category: 'session-exit',
      mimeType: 'audio/mpeg',
      dataBase64: Buffer.from([9, 8, 7]).toString('base64')
    })
    expect(harness.delivered[0].id).toEqual(expect.any(String))

    const status = harness.service.status()
    expect(status).toMatchObject({ playing: false, queued: 0, lastError: null })
    expect(harness.recorded.some((event) => event.type === 'announcement.played')).toBe(true)

    // The request really was shaped like the documented convert call.
    const [url, init] = harness.fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-abc?output_format=mp3_44100_128'
    )
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'xi-api-key': 'test-key-123',
      'Content-Type': 'application/json'
    })
    expect(String(init?.body)).toContain('"text":"Session finished"')
    expect(String(init?.body)).toContain('"model_id":"eleven_multilingual_v2"')
  })

  it('sets lastError without throwing when the API answers non-2xx', async () => {
    const harness = createHarness()
    harness.fetchMock.mockImplementation(async () =>
      jsonResponse(401, '{"detail":{"status":"api_key_not_valid","message":"invalid key"}}')
    )

    await expect(harness.service.announce('error', 'Something broke')).resolves.toBeUndefined()

    expect(harness.delivered).toHaveLength(0)
    const lastError = harness.service.status().lastError
    expect(lastError).not.toBeNull()
    expect(lastError).toContain('401')
    expect(lastError).not.toContain('test-key-123')

    const failure = harness.recorded.find((event) => event.type === 'announcement.failed')
    expect(failure).toBeDefined()
    expect(failure?.level).toBe('error')
    expect(failure?.details?.httpStatus).toBe(401)
  })

  it('suppresses duplicates inside the 10 second window', async () => {
    const harness = createHarness()

    await harness.service.announce('error', 'Same failure')
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)

    await harness.service.announce('error', 'Same failure')
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)

    // The same wording under a different category is a different announcement.
    await harness.service.announce('agent-event', 'Same failure')
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(10_001)

    await harness.service.announce('error', 'Same failure')
    expect(harness.fetchMock).toHaveBeenCalledTimes(3)
  })

  it('caps the queue at 3 pending items, dropping the oldest', async () => {
    const harness = createHarness()
    const pending: Array<(response: Response) => void> = []
    const requested: string[] = []
    harness.fetchMock.mockImplementation((_input, init) => {
      const raw = typeof init?.body === 'string' ? init.body : ''
      let text = ''
      try {
        const parsed: unknown = JSON.parse(raw)
        if (isRecord(parsed) && typeof parsed.text === 'string') text = parsed.text
      } catch {
        /* not a JSON body in this test's scope */
      }
      requested.push(text)
      return new Promise<Response>((resolve) => {
        pending.push(resolve)
      })
    })

    const announcements = ['one', 'two', 'three', 'four', 'five'].map((text) =>
      harness.service.announce('error', text)
    )

    // First item is synthesising; exactly three are pending behind it.
    expect(harness.service.status().queued).toBe(3)
    expect(pending).toHaveLength(1)

    while (pending.length > 0) {
      const resolve = pending.shift()
      if (!resolve) break
      resolve(audioResponse())
      await settle()
    }

    await Promise.all(announcements)
    // "two" was dropped (oldest of the pending three) and never requested.
    expect(requested).toEqual(['one', 'three', 'four', 'five'])
    expect(harness.delivered).toHaveLength(4)
    expect(harness.service.status().queued).toBe(0)
    expect(harness.service.status().playing).toBe(false)
  })

  it('dispose() clears the queue and reports idle', async () => {
    const harness = createHarness()
    const pending: Array<(response: Response) => void> = []
    harness.fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve)
        })
    )

    const first = harness.service.announce('error', 'one')
    const second = harness.service.announce('error', 'two')
    const third = harness.service.announce('error', 'three')
    expect(harness.service.status().queued).toBe(2)

    harness.service.dispose()
    expect(harness.service.status().queued).toBe(0)
    expect(harness.service.status().playing).toBe(false)

    pending.shift()?.(audioResponse())
    await Promise.all([first, second, third])

    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.service.status().queued).toBe(0)
    expect(harness.service.status().playing).toBe(false)
    expect(harness.delivered.length).toBeLessThanOrEqual(1)
  })

  it('test() synthesizes for real and delivers the audio once', async () => {
    const harness = createHarness()
    harness.fetchMock.mockImplementation(async () => audioResponse([4, 5, 6]))

    const result = await harness.service.test()

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/succeeded/i)
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0].category).toBe('test')
    expect(harness.delivered[0].dataBase64).toBe(Buffer.from([4, 5, 6]).toString('base64'))
    expect(harness.service.status().lastError).toBeNull()
  })

  it('test() surfaces the real HTTP failure', async () => {
    const harness = createHarness()
    harness.fetchMock.mockImplementation(async () => jsonResponse(422, '{"detail":"bad model"}'))

    const result = await harness.service.test()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('422')
    expect(harness.delivered).toHaveLength(0)
    expect(harness.service.status().lastError).toContain('422')
  })
})

describe('ElevenLabs TTS client', () => {
  it('synthesize() issues the documented convert request', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockImplementation(async () => audioResponse([1, 2]))

    const result = await synthesize(
      { text: 'Hello there', voiceId: 'voice-1', modelId: 'eleven_multilingual_v2' },
      createTtsContext(fetchMock)
    )

    expect(result.ok).toBe(true)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.audio?.byteLength).toBe(2)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128'
    )
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'xi-api-key': 'test-key-123' })
    expect(String(init?.body)).toContain('"text":"Hello there"')
    expect(String(init?.body)).toContain('"model_id":"eleven_multilingual_v2"')
  })

  it('synthesize() returns the real status, a bounded excerpt, and never the key', async () => {
    const apiKey = 'sk_super_secret_value'
    const body = `rejected key ${apiKey} ${'x'.repeat(500)}`
    const fetchMock = createFetchMock()
    fetchMock.mockImplementation(async () => jsonResponse(500, body))

    const result = await synthesize(
      { text: 'Hello', voiceId: 'voice-1', modelId: 'eleven_multilingual_v2' },
      createTtsContext(fetchMock, apiKey)
    )

    const message = result.message ?? ''
    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
    expect(result.audio).toBeUndefined()
    expect(message.length).toBeLessThanOrEqual(300)
    expect(message).not.toContain(apiKey)
    expect(message).toContain('<redacted>')
  })

  it('synthesize() never throws on a network failure', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockImplementation(async () => {
      throw new TypeError('connect ECONNREFUSED')
    })

    const result = await synthesize(
      { text: 'Hello', voiceId: 'voice-1', modelId: 'eleven_multilingual_v2' },
      createTtsContext(fetchMock)
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('ECONNREFUSED')
  })

  it('synthesize() refuses without a key or voice and makes no request', async () => {
    const fetchMock = createFetchMock()

    const noKey = await synthesize(
      { text: 'Hello', voiceId: 'voice-1', modelId: 'eleven_multilingual_v2' },
      createTtsContext(fetchMock, null)
    )
    expect(noKey.ok).toBe(false)
    expect(noKey.message).toMatch(/API key/i)

    const noVoice = await synthesize(
      { text: 'Hello', voiceId: '', modelId: 'eleven_multilingual_v2' },
      createTtsContext(fetchMock)
    )
    expect(noVoice.ok).toBe(false)
    expect(noVoice.message).toMatch(/voice/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checkAccount() hits the subscription endpoint and reports what it returned', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, JSON.stringify({ tier: 'starter', status: 'active' }))
    )

    const result = await checkAccount(createTtsContext(fetchMock))

    expect(result.ok).toBe(true)
    expect(result.message).toContain('starter')
    expect(result.message).toContain('active')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/user/subscription')
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({ 'xi-api-key': 'test-key-123' })
  })

  it('checkAccount() fails honestly without a key and on HTTP errors', async () => {
    const fetchMock = createFetchMock()

    const missingKey = await checkAccount(createTtsContext(fetchMock, null))
    expect(missingKey.ok).toBe(false)
    expect(missingKey.message).toMatch(/API key/i)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockImplementation(async () => jsonResponse(401, '{"detail":"unauthorized"}'))
    const rejected = await checkAccount(createTtsContext(fetchMock))
    expect(rejected.ok).toBe(false)
    expect(rejected.status).toBe(401)
    expect(rejected.message).toContain('401')
  })

  it('listVoices() returns the first 50 voices from the voices endpoint', async () => {
    const voices = Array.from({ length: 60 }, (_, index) => ({
      voice_id: `voice-${index}`,
      name: `Voice ${index}`
    }))
    const fetchMock = createFetchMock()
    fetchMock.mockImplementation(async () => jsonResponse(200, JSON.stringify({ voices })))

    const result = await listVoices(createTtsContext(fetchMock))

    expect(result.ok).toBe(true)
    expect(result.voices).toHaveLength(50)
    expect(result.voices[0]).toEqual({ id: 'voice-0', name: 'Voice 0' })
    expect(result.message).toContain('50 of 60')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/voices')
    expect(init?.headers).toMatchObject({ 'xi-api-key': 'test-key-123' })
  })

  it('listVoices() fails honestly without a key', async () => {
    const fetchMock = createFetchMock()
    const result = await listVoices(createTtsContext(fetchMock, null))
    expect(result.ok).toBe(false)
    expect(result.voices).toHaveLength(0)
    expect(result.message).toMatch(/API key/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
