/**
 * Direct HTTP clients for the three prompt providers. Every endpoint fact in
 * this module was verified against the official documentation:
 *
 * - Ollama: `GET {base}/api/tags` returns `{ models: [{ name, modified_at,
 *   ... }] }` for installed models, and `POST {base}/api/chat` with
 *   `{ model, messages, stream: false }` returns `{ message: { content } }`
 *   (or `{ error }`) for one non-streaming completion.
 *   https://github.com/ollama/ollama/blob/main/docs/api.md
 * - Google Generative Language API: authentication is the `x-goog-api-key`
 *   header (documented for REST calls; a `?key=` query parameter also works,
 *   but the header never puts the secret into a URL).
 *   https://ai.google.dev/gemini-api/docs/api-key
 *   `GET {base}/models?pageSize=1000` (unpaginated default is 50 — too small
 *   to reliably reach the Gemma entries) returns `{ models: [{ name:
 *   "models/...", supportedGenerationMethods: [...], ... }] }`, and Gemma
 *   models ARE exposed on this API (e.g. `models/gemma-4-26b-a4b-it`,
 *   `models/gemma-4-31b-it`, `models/gemma-3-27b-it`).
 *   https://ai.google.dev/api/models
 *   https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
 *   `POST {base}/models/{model}:generateContent` with a `{ contents: [{ role,
 *   parts: [{ text }] }] }` body returns `{ candidates: [{ content: { parts:
 *   [{ text }] } }] }`.
 *   https://ai.google.dev/api/generate-content
 *
 * Gemma caveat: hosted Gemma models reject the `systemInstruction` field for
 * some generations (HTTP 400 "Developer instruction is not enabled" on
 * Gemma 3), and community reports show 500s when it is sent without a role.
 * Google's documented pattern that works for every Gemma generation is to put
 * the system prompt at the top of the first user turn, so that is what the
 * Google client does here.
 *
 * Rules kept everywhere:
 * - None of these functions ever throws; every path returns a result object.
 * - Every request is bounded by an AbortController using `ctx.timeoutMs`.
 * - Non-2xx failures report the real status code plus at most 200 characters
 *   of response body, scrubbed of the secret.
 * - No message ever contains the secret value.
 */
import type { PromptProviderId } from '@shared/types'

export interface ProviderContext {
  fetchImpl: typeof fetch
  timeoutMs: number
  getSecret: (slot: 'google') => string | null
}

export interface ProviderConfig {
  enabled: boolean
  baseUrl: string
  model: string
}

export interface ProviderTestResult {
  ok: boolean
  reachable: boolean
  model: string | null
  message: string
  availableModels?: string[]
}

export interface ProviderCompleteResult {
  ok: boolean
  text: string
  model: string | null
  message: string
}

export interface ProviderCompleteArgs {
  config: ProviderConfig
  system: string
  user: string
}

/** One implementation per provider id. */
export interface PromptProvider {
  id: PromptProviderId
  test(config: ProviderConfig, ctx: ProviderContext): Promise<ProviderTestResult>
  complete(args: ProviderCompleteArgs, ctx: ProviderContext): Promise<ProviderCompleteResult>
}

/** Used whenever settings leave the endpoint blank. */
export const DEFAULT_PROVIDER_BASE_URLS: Record<PromptProviderId, string> = {
  ollama: 'http://127.0.0.1:11434',
  google: 'https://generativelanguage.googleapis.com/v1beta'
}

/**
 * Hosted Gemma is only ever called against Google's official endpoint with the
 * user's API key — VoxTerm deliberately offers no base-URL field for Google.
 */
const GOOGLE_BASE_URL = DEFAULT_PROVIDER_BASE_URLS.google

const BODY_EXCERPT_LIMIT = 200
const MAX_LISTED_MODELS = 40
/** Google lists a few hundred models; bound the scan regardless. */
const MAX_SCANNED_MODELS = 500

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function effectiveBaseUrl(id: PromptProviderId, config: ProviderConfig): string {
  return (config.baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[id]).replace(/\/+$/, '')
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

type HttpOutcome =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'failure'; message: string }

/** One bounded request. Resolves to a structured outcome and never throws. */
async function send(
  ctx: ProviderContext,
  url: string,
  init: RequestInit
): Promise<HttpOutcome> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, ctx.timeoutMs))
  try {
    const response = await ctx.fetchImpl(url, { ...init, signal: controller.signal })
    let body = ''
    try {
      body = await response.text()
    } catch {
      body = ''
    }
    return { kind: 'response', status: response.status, body }
  } catch (error) {
    // The only abort this code performs is its own timeout, so an AbortError
    // means the deadline elapsed before any response arrived.
    if (timedOut) {
      return { kind: 'failure', message: `Request timed out after ${ctx.timeoutMs} ms.` }
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return { kind: 'failure', message: 'Request was aborted before a response arrived.' }
    }
    return { kind: 'failure', message: `Network error: ${describeError(error)}` }
  } finally {
    clearTimeout(timer)
  }
}

function describeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return collapse(detail).slice(0, BODY_EXCERPT_LIMIT)
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** At most 200 characters of the body, whitespace-collapsed. */
function excerpt(body: string): string {
  const flat = collapse(body)
  if (flat.length === 0) return ''
  return flat.length > BODY_EXCERPT_LIMIT ? `${flat.slice(0, BODY_EXCERPT_LIMIT)}…` : flat
}

/**
 * Remove the secret from anything user-visible: the literal key, an echoed
 * `Bearer …` header, or a `?key=…` query parameter, then bound the length.
 */
function scrub(value: string, secret: string | null): string {
  let output = value
  if (secret && secret.length >= 4) {
    output = output.split(secret).join('<redacted>')
  }
  output = output.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
  output = output.replace(/([?&]key=)[^\s&]+/gi, '$1<redacted>')
  return output.slice(0, BODY_EXCERPT_LIMIT)
}

/** `Provider request failed (HTTP <status>)` + scrubbed detail, max 200 chars. */
function failureMessage(
  providerLabel: string,
  status: number,
  body: string,
  secret: string | null
): string {
  const detail = failureDetail(body, secret)
  const headline = `${providerLabel} request failed (HTTP ${status})`
  return detail ? `${headline}: ${detail}` : `${headline}.`
}

/** Prefer the API's own error message; fall back to a raw body excerpt. */
function failureDetail(body: string, secret: string | null): string {
  const parsed = parseJson(body)
  const fromApi = parsed.ok ? serverErrorMessage(parsed.data) : null
  const excerpted = excerpt(fromApi ?? body)
  return excerpted.length > 0 ? scrub(excerpted, secret) : ''
}

type ParsedJson = { ok: true; data: unknown } | { ok: false }

function parseJson(body: string): ParsedJson {
  try {
    return { ok: true, data: JSON.parse(body) as unknown }
  } catch {
    return { ok: false }
  }
}

/** Common error envelopes: `{ error: "…" }`, `{ error: { message } }`, `{ message }`. */
function serverErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null
  const error: unknown = data.error
  if (typeof error === 'string' && error.trim().length > 0) return error
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof data.message === 'string' && data.message.trim().length > 0) return data.message
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

interface OllamaTag {
  name: string
  modifiedAt: number
}

type OllamaListOutcome =
  | { kind: 'tags'; tags: string[] }
  | { kind: 'failed'; reachable: boolean; message: string }

/** `GET /api/tags`; tags are returned newest-first so auto-pick prefers them. */
async function listOllamaTags(
  config: ProviderConfig,
  ctx: ProviderContext
): Promise<OllamaListOutcome> {
  const base = effectiveBaseUrl('ollama', config)
  const outcome = await send(ctx, joinUrl(base, '/api/tags'), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (outcome.kind === 'failure') {
    return {
      kind: 'failed',
      reachable: false,
      message: `Ollama is not reachable at ${base}: ${outcome.message}`
    }
  }
  if (!isSuccess(outcome.status)) {
    return {
      kind: 'failed',
      reachable: true,
      message: failureMessage('Ollama', outcome.status, outcome.body, null)
    }
  }
  const parsed = parseJson(outcome.body)
  if (!parsed.ok || !isRecord(parsed.data)) {
    return {
      kind: 'failed',
      reachable: true,
      message: 'Ollama responded, but /api/tags did not return a model list.'
    }
  }
  const rawModels: unknown = parsed.data.models
  if (!Array.isArray(rawModels)) {
    return {
      kind: 'failed',
      reachable: true,
      message: 'Ollama responded, but /api/tags did not return a model list.'
    }
  }
  const list: unknown[] = rawModels
  const tags: OllamaTag[] = []
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.length === 0) continue
    const modifiedRaw = typeof entry.modified_at === 'string' ? entry.modified_at : ''
    const parsedTime = Date.parse(modifiedRaw)
    tags.push({ name: entry.name, modifiedAt: Number.isNaN(parsedTime) ? 0 : parsedTime })
    if (tags.length >= MAX_SCANNED_MODELS) break
  }
  // Ollama does not document a list order; sort by modification time so the
  // "newest tag first" preference for Gemma auto-detection is deterministic.
  tags.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return { kind: 'tags', tags: tags.map((tag) => tag.name) }
}

function pickOllamaGemma(tags: string[]): string | null {
  return tags.find((tag) => tag.toLowerCase().includes('gemma')) ?? null
}

/** Tolerate `gemma3` vs `gemma3:latest`; `gemma3:12b` stays distinct. */
function normalizeOllamaTag(name: string): string {
  const lower = name.trim().toLowerCase()
  return lower.endsWith(':latest') ? lower.slice(0, -':latest'.length) : lower
}

async function testOllama(
  config: ProviderConfig,
  ctx: ProviderContext
): Promise<ProviderTestResult> {
  const listed = await listOllamaTags(config, ctx)
  const availableModels =
    listed.kind === 'tags' ? listed.tags.slice(0, MAX_LISTED_MODELS) : undefined
  if (listed.kind === 'failed') {
    return {
      ok: false,
      reachable: listed.reachable,
      model: config.model.trim() || null,
      message: listed.message,
      ...(availableModels ? { availableModels } : {})
    }
  }
  const configured = config.model.trim()
  if (configured.length > 0) {
    const installed = listed.tags.some(
      (tag) => normalizeOllamaTag(tag) === normalizeOllamaTag(configured)
    )
    if (!installed) {
      return {
        ok: false,
        reachable: true,
        model: configured,
        message: `Ollama is reachable, but the configured model "${configured}" is not installed.`,
        availableModels
      }
    }
    return {
      ok: true,
      reachable: true,
      model: configured,
      message: `Ollama is reachable; using configured model "${configured}".`,
      availableModels
    }
  }
  const detected = pickOllamaGemma(listed.tags)
  if (detected === null) {
    return {
      ok: false,
      reachable: true,
      model: null,
      message: `Ollama is reachable, but no model was found: no Gemma model is installed (${listed.tags.length} model(s) present).`,
      availableModels
    }
  }
  return {
    ok: true,
    reachable: true,
    model: detected,
    message: `Ollama is reachable; no model configured, so "${detected}" was auto-detected from the newest installed Gemma model.`,
    availableModels
  }
}

async function completeOllama(
  args: ProviderCompleteArgs,
  ctx: ProviderContext
): Promise<ProviderCompleteResult> {
  const { system, user } = args
  const base = effectiveBaseUrl('ollama', args.config)
  let model = args.config.model.trim()
  if (model.length === 0) {
    const listed = await listOllamaTags(args.config, ctx)
    if (listed.kind === 'failed') {
      return { ok: false, text: '', model: null, message: listed.message }
    }
    const detected = pickOllamaGemma(listed.tags)
    if (detected === null) {
      return {
        ok: false,
        text: '',
        model: null,
        message: `No model was found: no Gemma model is installed in Ollama (${listed.tags.length} model(s) present). Pull one (for example "ollama pull gemma3:12b") or set a model in Settings.`
      }
    }
    model = detected
  }

  const outcome = await send(ctx, joinUrl(base, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream: false
    })
  })
  if (outcome.kind === 'failure') {
    return { ok: false, text: '', model, message: `Ollama request failed: ${outcome.message}` }
  }
  if (!isSuccess(outcome.status)) {
    return {
      ok: false,
      text: '',
      model,
      message: failureMessage('Ollama', outcome.status, outcome.body, null)
    }
  }
  const parsed = parseJson(outcome.body)
  if (!parsed.ok) {
    return {
      ok: false,
      text: '',
      model,
      message: 'Ollama returned a response that is not valid JSON.'
    }
  }
  const content = extractOllamaContent(parsed.data)
  if (content === null) {
    const detail = serverErrorMessage(parsed.data)
    return {
      ok: false,
      text: '',
      model,
      message: detail
        ? `Ollama returned no text: ${scrub(excerpt(detail), null)}`
        : 'Ollama returned no text.'
    }
  }
  const text = content.trim()
  if (text.length === 0) {
    return { ok: false, text: '', model, message: 'Ollama returned an empty response.' }
  }
  return { ok: true, text, model, message: `Enhanced with Ollama model "${model}".` }
}

function extractOllamaContent(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.message)) return null
  const content: unknown = data.message.content
  return typeof content === 'string' ? content : null
}

// ---------------------------------------------------------------------------
// Google Generative Language API
// ---------------------------------------------------------------------------

interface GoogleModelList {
  /** Ids without the `models/` prefix that can serve generateContent. */
  ids: string[]
}

type GoogleListOutcome =
  | { kind: 'models'; list: GoogleModelList }
  | { kind: 'failed'; reachable: boolean; message: string }

/** Strip the `models/` resource prefix users may have pasted into Settings. */
function normalizeGoogleModelId(model: string): string {
  return model.trim().replace(/^models\//, '')
}

async function listGoogleModels(
  ctx: ProviderContext,
  secret: string
): Promise<GoogleListOutcome> {
  const base = GOOGLE_BASE_URL
  // pageSize=1000 is the documented maximum; the default of 50 could hide Gemma.
  const outcome = await send(ctx, `${joinUrl(base, '/models')}?pageSize=1000`, {
    method: 'GET',
    headers: {
      'x-goog-api-key': secret,
      Accept: 'application/json'
    }
  })
  if (outcome.kind === 'failure') {
    return {
      kind: 'failed',
      reachable: false,
      message: `Google Generative Language API is not reachable at ${base}: ${outcome.message}`
    }
  }
  if (!isSuccess(outcome.status)) {
    return {
      kind: 'failed',
      reachable: true,
      message: failureMessage('Google Generative Language API', outcome.status, outcome.body, secret)
    }
  }
  const parsed = parseJson(outcome.body)
  if (!parsed.ok || !isRecord(parsed.data)) {
    return {
      kind: 'failed',
      reachable: true,
      message: 'Google responded, but /models did not return a model list.'
    }
  }
  const rawModels: unknown = parsed.data.models
  if (!Array.isArray(rawModels)) {
    return {
      kind: 'failed',
      reachable: true,
      message: 'Google responded, but /models did not return a model list.'
    }
  }
  const list: unknown[] = rawModels
  const ids: string[] = []
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.length === 0) continue
    const methods: unknown = entry.supportedGenerationMethods
    const usable =
      !Array.isArray(methods) ||
      (methods as unknown[]).some((method) => method === 'generateContent')
    if (!usable) continue
    ids.push(entry.name.replace(/^models\//, ''))
    if (ids.length >= MAX_SCANNED_MODELS) break
  }
  return { kind: 'models', list: { ids } }
}

async function testGoogle(
  config: ProviderConfig,
  ctx: ProviderContext
): Promise<ProviderTestResult> {
  const secret = ctx.getSecret('google')
  const configured = normalizeGoogleModelId(config.model)
  if (!secret) {
    return {
      ok: false,
      reachable: false,
      model: configured || null,
      message: 'No Google API key is stored. Add one in Settings to use Google.'
    }
  }
  const listed = await listGoogleModels(ctx, secret)
  if (listed.kind === 'failed') {
    return {
      ok: false,
      reachable: listed.reachable,
      model: configured || null,
      message: listed.message
    }
  }
  const ids = listed.list.ids
  const gemmaIds = ids.filter((id) => id.toLowerCase().includes('gemma'))
  const availableModels = gemmaIds.slice(0, MAX_LISTED_MODELS)
  if (configured.length > 0) {
    if (!ids.includes(configured)) {
      return {
        ok: false,
        reachable: true,
        model: configured,
        message: `Google is reachable, but this API key exposes no model named "${configured}".`,
        availableModels
      }
    }
    return {
      ok: true,
      reachable: true,
      model: configured,
      message: `Google is reachable; using configured model "${configured}".`,
      availableModels
    }
  }
  const detected = gemmaIds[0] ?? null
  if (detected === null) {
    return {
      ok: false,
      reachable: true,
      model: null,
      message: `This API key exposes no Gemma model (${ids.length} other model(s) available).`,
      availableModels
    }
  }
  return {
    ok: true,
    reachable: true,
    model: detected,
    message: `Google is reachable; no model configured, so "${detected}" was auto-detected.`,
    availableModels
  }
}

async function completeGoogle(
  args: ProviderCompleteArgs,
  ctx: ProviderContext
): Promise<ProviderCompleteResult> {
  const { system, user } = args
  const secret = ctx.getSecret('google')
  if (!secret) {
    return {
      ok: false,
      text: '',
      model: null,
      message: 'No Google API key is stored. Add one in Settings to use Google.'
    }
  }
  const base = GOOGLE_BASE_URL
  let model = normalizeGoogleModelId(args.config.model)
  if (model.length === 0) {
    const listed = await listGoogleModels(ctx, secret)
    if (listed.kind === 'failed') {
      return { ok: false, text: '', model: null, message: listed.message }
    }
    const detected =
      listed.list.ids.find((id) => id.toLowerCase().includes('gemma')) ?? null
    if (detected === null) {
      return {
        ok: false,
        text: '',
        model: null,
        message: `This API key exposes no Gemma model (${listed.list.ids.length} other model(s) available).`
      }
    }
    model = detected
  }

  // The system prompt rides at the top of the first user turn: hosted Gemma
  // models reject the systemInstruction field on some generations, and this
  // first-turn form is the pattern Google documents for every Gemma model.
  const outcome = await send(ctx, `${joinUrl(base, '/models')}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': secret
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${system}\n\n${user}` }]
        }
      ]
    })
  })
  if (outcome.kind === 'failure') {
    return {
      ok: false,
      text: '',
      model,
      message: `Google request failed: ${outcome.message}`
    }
  }
  if (!isSuccess(outcome.status)) {
    return {
      ok: false,
      text: '',
      model,
      message: failureMessage('Google Generative Language API', outcome.status, outcome.body, secret)
    }
  }
  const parsed = parseJson(outcome.body)
  if (!parsed.ok) {
    return {
      ok: false,
      text: '',
      model,
      message: 'Google returned a response that is not valid JSON.'
    }
  }
  const text = extractGoogleText(parsed.data)
  if (text === null) {
    const detail = serverErrorMessage(parsed.data)
    return {
      ok: false,
      text: '',
      model,
      message: detail
        ? `Google returned no text: ${scrub(excerpt(detail), secret)}`
        : 'Google returned no text (the prompt may have been blocked by safety filters).'
    }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, text: '', model, message: 'Google returned an empty response.' }
  }
  return { ok: true, text: trimmed, model, message: `Enhanced with Google model "${model}".` }
}

/** `candidates[0].content.parts[].text`, ignoring hidden thought parts. */
function extractGoogleText(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    return null
  }
  const [first]: unknown[] = data.candidates
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return null
  }
  const parts: unknown[] = first.content.parts
  const pieces: string[] = []
  for (const part of parts) {
    if (!isRecord(part) || typeof part.text !== 'string') continue
    if (part.thought === true) continue
    pieces.push(part.text)
  }
  const joined = pieces.join('')
  return joined.length > 0 ? joined : null
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ollamaProvider: PromptProvider = {
  id: 'ollama',
  test: testOllama,
  complete: completeOllama
}

export const googleProvider: PromptProvider = {
  id: 'google',
  test: testGoogle,
  complete: completeGoogle
}

export const PROVIDERS: Record<PromptProviderId, PromptProvider> = {
  ollama: ollamaProvider,
  google: googleProvider
}
