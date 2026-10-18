import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsSchema, type Settings } from '@shared/schemas'
import type { PromptProviderId } from '@shared/types'
import {
  ENHANCE_SYSTEM_PROMPT,
  buildUserContent,
  collectProjectContext
} from '../src/main/prompts/instructions'
import { PromptService, resolveLocalOnly } from '../src/main/prompts/service'
import { Logger } from '../src/main/util/logger'

/**
 * Prompt-enhancement tests. Every provider conversation below happens against
 * a fake `fetch`, so the assertions are about VoxTerm's own behaviour: the
 * exact HTTP shape each provider (local Ollama, cloud Google Generative
 * Language API) receives, the privacy gates (local-only mode, disabled
 * providers, missing credentials, project-context consent), structured (never
 * thrown) failures, and the guarantee that a stored API key never appears in
 * a status or attempt message.
 */

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const TMP_BASE = '/tmp/opencode'
const LOG_DIRECTORY = join(TMP_BASE, 'voxterm-prompts-test-logs')

/** Deliberately recognisable secret, echoed back by failing fake servers. */
const GOOGLE_SECRET = 'AIzaLEAKED-SECRET-SECRET-VALUE'

const OLLAMA_BASE = 'http://127.0.0.1:11434'
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const OLLAMA_TAGS_RESPONSE = {
  models: [
    { name: 'llama3.2:latest', modified_at: '2024-01-01T00:00:00Z' },
    { name: 'gemma3:12b', modified_at: '2025-06-01T00:00:00Z' }
  ]
}

const GOOGLE_MODELS_RESPONSE = {
  models: [
    { name: 'models/gemma-4-26b-a4b-it', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
  ]
}

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
  return new Response(JSON.stringify(body) ?? '', {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

/** A server where every documented endpoint answers successfully. */
function successHandler(call: RecordedCall): Response {
  if (call.url.includes(':generateContent')) {
    return jsonResponse({ candidates: [{ content: { parts: [{ text: ' Enhanced by Google.  ' }] } }] })
  }
  if (call.url.includes('/api/chat')) {
    return jsonResponse({ message: { content: 'Enhanced by Ollama' } })
  }
  if (call.url.includes('/api/tags')) return jsonResponse(OLLAMA_TAGS_RESPONSE)
  if (call.url.includes('/models')) return jsonResponse(GOOGLE_MODELS_RESPONSE)
  return new Response('unexpected endpoint', { status: 404 })
}

/** A server that never answers; it only rejects when the client aborts. */
function hangingHandler(call: RecordedCall): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = call.init?.signal
    if (signal === null || signal === undefined) return
    signal.addEventListener('abort', () => {
      const error = new Error('This operation was aborted')
      error.name = 'AbortError'
      reject(error)
    })
  })
}

function parsedBody(call: RecordedCall): unknown {
  const raw = call.init?.body
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function mustFind(calls: RecordedCall[], predicate: (call: RecordedCall) => boolean): RecordedCall {
  const found = calls.find(predicate)
  if (found === undefined) throw new Error('expected a matching request to have been made')
  return found
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  const headers = call.init?.headers
  if (headers === null || headers === undefined) return undefined
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return entry?.[1]
  }
  const record = headers as Record<string, string>
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : record[key]
}

interface ProviderOverride {
  enabled?: boolean
  baseUrl?: string
  model?: string
}

function buildSettings(overrides: {
  prompts?: Partial<Omit<Settings['prompts'], 'ollama' | 'google'>> & {
    ollama?: ProviderOverride
    google?: ProviderOverride
  }
  privacy?: Partial<Settings['privacy']>
}): Settings {
  const prompts = overrides.prompts ?? {}
  return settingsSchema.parse({
    prompts: {
      localOnly: false,
      projectContext: false,
      timeoutSeconds: 10,
      priority: ['ollama', 'google'],
      ...prompts
    },
    privacy: { localOnlyMode: false, ...(overrides.privacy ?? {}) }
  })
}

interface Secrets {
  google: string | null
}

const DEFAULT_SECRETS: Secrets = { google: GOOGLE_SECRET }

function createService(options: {
  settings: Settings
  fetchImpl: typeof fetch
  secrets?: Partial<Secrets>
}): PromptService {
  const secrets: Secrets = { ...DEFAULT_SECRETS, ...(options.secrets ?? {}) }
  return new PromptService({
    getSettings: () => options.settings,
    getSecret: (slot) => secrets[slot],
    logger: new Logger({ directory: LOG_DIRECTORY, enabled: false, redact: true }),
    fetchImpl: options.fetchImpl
  })
}

const tempDirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A small workspace with dependency/VCS trees and a file whose CONTENT must never leak. */
async function makeWorkspace(): Promise<string> {
  await mkdir(TMP_BASE, { recursive: true })
  const dir = await mkdtemp(join(TMP_BASE, 'voxterm-prompts-ws-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'src'), { recursive: true })
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, 'alpha.ts'), 'export const secretFileContent = 42\n')
  await writeFile(join(dir, 'src', 'main.ts'), 'export {}\n')
  await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')
  await writeFile(join(dir, '.git', 'config'), '[core]\n')
  return dir
}

function statusOf(
  statuses: Awaited<ReturnType<PromptService['statuses']>>,
  id: PromptProviderId
): (typeof statuses)[number] {
  const found = statuses.find((status) => status.id === id)
  if (found === undefined) throw new Error(`expected a status entry for "${id}"`)
  return found
}

interface GoogleGenerateBody {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
  systemInstruction?: unknown
}

function asGoogleBody(value: unknown): GoogleGenerateBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object request body')
  }
  return value as GoogleGenerateBody
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

describe('buildUserContent', () => {
  it('returns the transcript untouched when there is no context', () => {
    expect(buildUserContent('fix the flaky test', null)).toBe('fix the flaky test')
    expect(buildUserContent('fix the flaky test', '   ')).toBe('fix the flaky test')
  })

  it('labels the context block as names-only reference', () => {
    const content = buildUserContent('fix the flaky test', 'alpha.ts')
    expect(content).toContain('Raw transcript (improve this):')
    expect(content).toContain('Workspace file and directory names (reference only')
    expect(content).toContain('alpha.ts')
  })
})

describe('collectProjectContext', () => {
  it('lists names only, skips dependency and VCS trees, and never reads file contents', async () => {
    const dir = await makeWorkspace()

    const context = await collectProjectContext(dir)

    expect(context).not.toBeNull()
    expect(context).toContain('alpha.ts')
    expect(context).toContain('src/')
    expect(context).toContain('src/main.ts')
    expect(context).not.toContain('node_modules')
    expect(context).not.toContain('.git')
    // Names only: no byte of any file's content may appear.
    expect(context).not.toContain('secretFileContent')
    expect(context).not.toContain('module.exports')
  })

  it('caps the listing at 60 entries', async () => {
    await mkdir(TMP_BASE, { recursive: true })
    const dir = await mkdtemp(join(TMP_BASE, 'voxterm-prompts-many-'))
    tempDirs.push(dir)
    for (let index = 0; index < 80; index += 1) {
      await writeFile(join(dir, `file-${index}.txt`), 'content must not appear\n')
    }

    const context = await collectProjectContext(dir)

    expect(context).not.toBeNull()
    expect(context?.split('\n')).toHaveLength(60)
    expect(context).not.toContain('content must not appear')
  })

  it('returns null for an empty, missing or blank directory', async () => {
    expect(await collectProjectContext('')).toBeNull()
    expect(await collectProjectContext(join(TMP_BASE, 'voxterm-definitely-missing'))).toBeNull()

    await mkdir(TMP_BASE, { recursive: true })
    const dir = await mkdtemp(join(TMP_BASE, 'voxterm-prompts-empty-'))
    tempDirs.push(dir)
    expect(await collectProjectContext(dir)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Privacy gate
// ---------------------------------------------------------------------------

describe('resolveLocalOnly', () => {
  it('is true when either local-only flag is set', () => {
    expect(resolveLocalOnly(buildSettings({}))).toBe(false)
    expect(resolveLocalOnly(buildSettings({ prompts: { localOnly: true } }))).toBe(true)
    expect(resolveLocalOnly(buildSettings({ privacy: { localOnlyMode: true } }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// statuses()
// ---------------------------------------------------------------------------

describe('PromptService.statuses', () => {
  it('probes every allowed provider with the documented request shapes', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: true, model: '' },
        google: { enabled: true, model: '' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()

    expect(statuses.map((status) => status.id)).toEqual(['ollama', 'google'])
    expect(statusOf(statuses, 'ollama')).toMatchObject({
      enabled: true,
      allowed: true,
      // No model configured yet, so `configured` stays false even though the
      // server is reachable and a Gemma tag can be auto-detected.
      configured: false,
      reachable: true,
      // Newest installed Gemma tag wins the auto-pick.
      model: 'gemma3:12b'
    })
    expect(statusOf(statuses, 'ollama').ms).not.toBeNull()
    expect(statusOf(statuses, 'google')).toMatchObject({
      allowed: true,
      configured: false,
      reachable: true,
      // First Gemma entry from the model list.
      model: 'gemma-4-26b-a4b-it'
    })
    expect(statusOf(statuses, 'google').message).toContain('auto-detected')

    // Google: the key travels as the x-goog-api-key header, never a query
    // parameter and never a bearer/Authorization header, and the list request
    // asks for the full page so Gemma cannot hide past page 1.
    const googleList = mustFind(calls, (call) => call.url.includes('googleapis') && call.url.includes('/models'))
    expect(googleList.url).toBe(`${GOOGLE_BASE}/models?pageSize=1000`)
    expect(googleList.url).not.toContain('key=')
    expect(headerOf(googleList, 'x-goog-api-key')).toBe(GOOGLE_SECRET)
    expect(headerOf(googleList, 'Authorization')).toBeUndefined()

    // Ollama: plain local tags list under the configured base URL.
    const ollamaTags = mustFind(calls, (call) => call.url.includes('127.0.0.1:11434'))
    expect(ollamaTags.url).toBe(`${OLLAMA_BASE}/api/tags`)
  })

  it('returns both providers in priority order, with omitted providers appended', async () => {
    const settings = buildSettings({
      prompts: { priority: ['google'], google: { enabled: true, model: 'gemma-4-31b-it' } }
    })
    const { fetchImpl } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()

    // `enabled` selects providers; `priority` only orders them.
    expect(statuses.map((status) => status.id)).toEqual(['google', 'ollama'])
  })

  it('never contacts a cloud provider while local-only mode is on', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: true,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()

    const google = statusOf(statuses, 'google')
    expect(google.allowed).toBe(false)
    expect(google.reachable).toBe(false)
    expect(google.ms).toBeNull()
    expect(google.message).toBe('Blocked by local-only mode.')
    expect(statusOf(statuses, 'ollama').reachable).toBe(true)
    expect(calls.every((call) => call.url.includes('127.0.0.1:11434'))).toBe(true)
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(false)
  })

  it('answers for disabled providers without touching the network', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: false, model: '' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()

    const google = statusOf(statuses, 'google')
    expect(google.enabled).toBe(false)
    expect(google.message).toBe('Disabled in settings.')
    expect(google.ms).toBeNull()
    expect(calls.every((call) => call.url.includes('127.0.0.1:11434'))).toBe(true)
  })

  it('marks a provider without a stored key as not configured', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: false },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl, secrets: { google: null } })

    const statuses = await service.statuses()

    expect(statusOf(statuses, 'google').configured).toBe(false)
    expect(statusOf(statuses, 'google').message).toBe(
      'No Google API key is stored. Add one in Settings to use Google.'
    )
    // No credential means no request: the fake server must not be contacted.
    expect(calls).toHaveLength(0)
  })

  it('reports a configured model this API key cannot see as reachable but unusable', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: false },
        google: { enabled: true, model: 'gemma-9000-nonexistent' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const status = statusOf(await service.statuses(), 'google')

    expect(status.reachable).toBe(true)
    expect(status.model).toBe('gemma-9000-nonexistent')
    expect(status.message).toContain('this API key exposes no model named "gemma-9000-nonexistent"')
    // The verdict was reached against the official endpoint with header auth.
    const list = mustFind(calls, (call) => call.url.includes('/models'))
    expect(list.url).toBe(`${GOOGLE_BASE}/models?pageSize=1000`)
    expect(headerOf(list, 'x-goog-api-key')).toBe(GOOGLE_SECRET)
  })

  it('never leaks a stored secret, even when a server echoes it back', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch((call) => {
      if (call.url.includes('/api/tags')) return jsonResponse(OLLAMA_TAGS_RESPONSE)
      return new Response(
        JSON.stringify({
          error: { message: `Invalid API key ${GOOGLE_SECRET} provided (x-goog-api-key ${GOOGLE_SECRET})` }
        }),
        { status: 401 }
      )
    })
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()

    for (const status of statuses) {
      expect(status.message).not.toContain(GOOGLE_SECRET)
      expect(status.message).not.toContain('LEAKED')
    }
    expect(statusOf(statuses, 'google').message).toContain('HTTP 401')
    // The failing request itself was still made (and authenticated).
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// test()
// ---------------------------------------------------------------------------

describe('PromptService.test', () => {
  it('runs a real probe for a disabled provider on explicit request', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        ollama: { enabled: false, model: '' },
        google: { enabled: false, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const status = await service.test('google')

    expect(status.enabled).toBe(false)
    expect(status.reachable).toBe(true)
    expect(status.model).toBe('gemma-4-31b-it')
    expect(status.message).toContain('using configured model "gemma-4-31b-it"')
    expect(status.ms).not.toBeNull()
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(true)
  })

  it('refuses to probe a provider that local-only mode forbids', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: true,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const status = await service.test('google')

    expect(status.allowed).toBe(false)
    expect(status.reachable).toBe(false)
    expect(status.ms).toBeNull()
    expect(status.message).toBe('Blocked by local-only mode.')
    expect(calls).toHaveLength(0)
  })

  it('surfaces a missing key without any request', async () => {
    const settings = buildSettings({
      prompts: {
        localOnly: false,
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl, secrets: { google: null } })

    const status = await service.test('google')

    expect(status.reachable).toBe(false)
    expect(status.configured).toBe(false)
    expect(status.message).toBe('No Google API key is stored. Add one in Settings to use Google.')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enhance()
// ---------------------------------------------------------------------------

describe('PromptService.enhance', () => {
  it('rejects an empty transcript before touching any provider', async () => {
    const settings = buildSettings({})
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: '   \n ' })

    expect(result.ok).toBe(false)
    expect(result.provider).toBeNull()
    expect(result.error).toBe('There is no transcript text to enhance.')
    expect(result.attempts).toEqual([])
    expect(result.enhanced).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('honours provider priority and falls back to the next provider on failure', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google', 'ollama'],
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl } = createFakeFetch((call) => {
      if (call.url.includes(':generateContent')) {
        return new Response(JSON.stringify({ error: { message: 'upstream overloaded' } }), {
          status: 503
        })
      }
      return successHandler(call)
    })
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'add um a retry flag to fetch.ts' })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('ollama')
    expect(result.enhanced).toBe('Enhanced by Ollama')
    expect(result.original).toBe('add um a retry flag to fetch.ts')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]).toMatchObject({ id: 'google', ok: false })
    expect(result.attempts[0].message).toContain('HTTP 503')
    expect(result.attempts[1]).toMatchObject({ id: 'ollama', ok: true })
  })

  it('records "blocked by local-only mode" for cloud providers and never calls them', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google', 'ollama'],
        localOnly: true,
        projectContext: true,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })
    const cwd = await makeWorkspace()

    const result = await service.enhance({ text: 'fix the bug in alpha.ts', cwd })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('ollama')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]).toMatchObject({
      id: 'google',
      ok: false,
      message: 'blocked by local-only mode'
    })
    expect(result.attempts[1]).toMatchObject({ id: 'ollama', ok: true })
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(false)
    // The blocked provider never sees the transcript or the project context.
    const chat = mustFind(calls, (call) => call.url.includes('/api/chat'))
    expect(JSON.stringify(parsedBody(chat))).toContain('alpha.ts')
  })

  it('skips a disabled provider without a network call', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google', 'ollama'],
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: false, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'fix the flaky test in alpha.ts' })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('ollama')
    expect(result.attempts[0]).toMatchObject({
      id: 'google',
      ok: false,
      message: 'Skipped: provider is disabled in settings.'
    })
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(false)
  })

  it('skips a provider that has no stored credential', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google', 'ollama'],
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl, secrets: { google: null } })

    const result = await service.enhance({ text: 'fix the flaky test in alpha.ts' })

    expect(result.ok).toBe(true)
    expect(result.attempts[0]).toMatchObject({
      id: 'google',
      ok: false,
      message: 'Skipped: no API key is stored for this provider.'
    })
    expect(calls.some((call) => call.url.includes('googleapis'))).toBe(false)
  })

  it('surfaces a non-2xx response as a structured failure instead of throwing', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['ollama'],
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: false }
      }
    })
    const { fetchImpl } = createFakeFetch((call) => {
      if (call.url.includes('/api/chat')) return new Response('upstream overloaded', { status: 503 })
      return successHandler(call)
    })
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(false)
    expect(result.provider).toBeNull()
    expect(result.error).toBe('All prompt providers failed.')
    // Total failure keeps the original transcript usable.
    expect(result.original).toBe('do the thing')
    expect(result.enhanced).toBe('do the thing')
    expect(result.attempts[0]).toMatchObject({ id: 'ollama', ok: false })
    expect(result.attempts[0].message).toContain('HTTP 503')
    expect(result.attempts[0].message).toContain('upstream overloaded')
  })

  it('reports a response body that is not valid JSON', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['ollama'],
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: false }
      }
    })
    const { fetchImpl } = createFakeFetch((call) => {
      if (call.url.includes('/api/chat')) return new Response('<<<not json>>>', { status: 200 })
      return successHandler(call)
    })
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(false)
    expect(result.attempts[0].message).toContain('not valid JSON')
  })

  it('times out a hung provider request instead of waiting forever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const settings = buildSettings({
      prompts: {
        priority: ['ollama'],
        timeoutSeconds: 10,
        ollama: { enabled: true, model: 'gemma3:12b' },
        google: { enabled: false }
      }
    })
    const { fetchImpl } = createFakeFetch(hangingHandler)
    const service = createService({ settings, fetchImpl })

    const pending = service.enhance({ text: 'do the thing' })
    await vi.advanceTimersByTimeAsync(11_000)
    const result = await pending

    expect(result.ok).toBe(false)
    expect(result.enhanced).toBe('do the thing')
    expect(result.attempts[0].message).toContain('timed out')
    expect(result.attempts[0].message).toContain('10000 ms')
  })

  it('reports blocked=true when every provider is unavailable', async () => {
    const settings = buildSettings({
      prompts: {
        ollama: { enabled: false },
        google: { enabled: false }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.error).toBe('No prompt provider was allowed or configured.')
    expect(result.enhanced).toBe('do the thing')
    expect(result.attempts.every((attempt) => attempt.ok === false)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('sends the Google request with the key as a header and the system prompt in the first user turn', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google'],
        ollama: { enabled: false },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'list the open todos' })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('google')
    expect(result.enhanced).toBe('Enhanced by Google.')

    const call = mustFind(calls, (candidate) => candidate.url.includes(':generateContent'))
    expect(call.url).toBe(`${GOOGLE_BASE}/models/gemma-4-31b-it:generateContent`)
    expect(call.url).not.toContain('key=')
    expect(headerOf(call, 'x-goog-api-key')).toBe(GOOGLE_SECRET)
    expect(headerOf(call, 'Authorization')).toBeUndefined()

    const body = asGoogleBody(parsedBody(call))
    // Gemma generations that reject `systemInstruction` are handled by putting
    // the system prompt at the top of the first user turn.
    expect(body.systemInstruction).toBeUndefined()
    expect(body.contents).toHaveLength(1)
    expect(body.contents[0]?.role).toBe('user')
    expect(body.contents[0]?.parts[0]?.text).toBe(`${ENHANCE_SYSTEM_PROMPT}\n\nlist the open todos`)
  })

  it('always calls the official Google endpoint even when a custom base URL is stored', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google'],
        ollama: { enabled: false },
        google: {
          enabled: true,
          model: 'gemma-4-31b-it',
          // A legacy/stale custom endpoint: it must be ignored entirely —
          // VoxTerm removed the Google base-URL field and always dials the
          // official endpoint.
          baseUrl: 'https://voxterm-proxy.example.com/v1'
        }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const statuses = await service.statuses()
    expect(statusOf(statuses, 'google').reachable).toBe(true)

    const result = await service.enhance({ text: 'do the thing' })
    expect(result.ok).toBe(true)

    // Every Google request (model list and generateContent) went to the
    // official endpoint with header auth...
    const googleCalls = calls.filter((call) => !call.url.includes('127.0.0.1'))
    expect(googleCalls.length).toBeGreaterThan(0)
    for (const call of googleCalls) {
      expect(call.url.startsWith(`${GOOGLE_BASE}/`)).toBe(true)
      expect(headerOf(call, 'x-goog-api-key')).toBe(GOOGLE_SECRET)
    }
    // ...and the stored custom base URL was never dialled.
    expect(calls.some((call) => call.url.includes('voxterm-proxy.example.com'))).toBe(false)
  })

  it('auto-detects a Google Gemma model from the model list when none is configured', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google'],
        ollama: { enabled: false },
        google: { enabled: true, model: '' }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('google')
    expect(result.enhanced).toBe('Enhanced by Google.')
    // The first Gemma model from /models is the one called, authenticated
    // with the x-goog-api-key header.
    const call = mustFind(calls, (candidate) => candidate.url.includes(':generateContent'))
    expect(call.url).toBe(`${GOOGLE_BASE}/models/gemma-4-26b-a4b-it:generateContent`)
    expect(headerOf(call, 'x-goog-api-key')).toBe(GOOGLE_SECRET)
  })

  it('attaches project context only when it is enabled, and only to the provider that runs', async () => {
    const cwd = await makeWorkspace()
    const base = {
      priority: ['ollama'] as PromptProviderId[],
      ollama: { enabled: true, model: 'gemma3:12b' },
      google: { enabled: false }
    }

    // Consent off: the workspace listing must not travel.
    const off = buildSettings({ prompts: { ...base, projectContext: false } })
    const offFetch = createFakeFetch(successHandler)
    const offResult = await createService({ settings: off, fetchImpl: offFetch.fetchImpl }).enhance({
      text: 'fix the bug in alpha.ts',
      cwd
    })
    const offBody = JSON.stringify(parsedBody(mustFind(offFetch.calls, (call) => call.url.includes('/api/chat'))))
    expect(offResult.usedProjectContext).toBe(false)
    expect(offBody).not.toContain('Workspace file and directory names')
    expect(offBody).not.toContain('src/main.ts')
    expect(offBody).not.toContain('secretFileContent')

    // Consent on, but no cwd: still nothing to send.
    const noCwd = buildSettings({ prompts: { ...base, projectContext: true } })
    const noCwdFetch = createFakeFetch(successHandler)
    const noCwdResult = await createService({
      settings: noCwd,
      fetchImpl: noCwdFetch.fetchImpl
    }).enhance({ text: 'fix the bug in alpha.ts' })
    expect(noCwdResult.usedProjectContext).toBe(false)

    // Consent on and a cwd: names-only listing reaches the one provider called.
    const on = buildSettings({ prompts: { ...base, projectContext: true } })
    const onFetch = createFakeFetch(successHandler)
    const onResult = await createService({ settings: on, fetchImpl: onFetch.fetchImpl }).enhance({
      text: 'fix the bug in alpha.ts',
      cwd
    })
    const onBody = JSON.stringify(parsedBody(mustFind(onFetch.calls, (call) => call.url.includes('/api/chat'))))
    expect(onResult.ok).toBe(true)
    expect(onResult.usedProjectContext).toBe(true)
    expect(onBody).toContain('alpha.ts')
    expect(onBody).toContain('src/main.ts')
    expect(onBody).not.toContain('node_modules')
    expect(onBody).not.toContain('.git')
    expect(onBody).not.toContain('secretFileContent')
  })

  it('never leaks a secret through an attempt message', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['google'],
        ollama: { enabled: false },
        google: { enabled: true, model: 'gemma-4-31b-it' }
      }
    })
    const { fetchImpl } = createFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { message: `Bad key ${GOOGLE_SECRET} (x-goog-api-key ${GOOGLE_SECRET})` }
          }),
          { status: 401 }
        )
    )
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(false)
    const [first] = result.attempts
    expect(first?.id).toBe('google')
    expect(first?.message).toContain('HTTP 401')
    expect(first?.message).not.toContain(GOOGLE_SECRET)
    expect(first?.message).not.toContain('LEAKED')
  })

  it('auto-detects an installed Gemma model when none is configured', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['ollama'],
        ollama: { enabled: true, model: '' },
        google: { enabled: false }
      }
    })
    const { fetchImpl, calls } = createFakeFetch(successHandler)
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(true)
    const chat = mustFind(calls, (call) => call.url.includes('/api/chat'))
    const body = parsedBody(chat)
    expect(JSON.stringify(body)).toContain('"model":"gemma3:12b"')
  })

  it('reports "no model was found" when Ollama has no Gemma model installed', async () => {
    const settings = buildSettings({
      prompts: {
        priority: ['ollama'],
        ollama: { enabled: true, model: '' },
        google: { enabled: false }
      }
    })
    const { fetchImpl } = createFakeFetch((call) => {
      if (call.url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'llama3.2:latest', modified_at: '2024-01-01T00:00:00Z' }] })
      }
      return successHandler(call)
    })
    const service = createService({ settings, fetchImpl })

    const result = await service.enhance({ text: 'do the thing' })

    expect(result.ok).toBe(false)
    expect(result.attempts[0].message).toMatch(/no model was found/i)
  })
})
