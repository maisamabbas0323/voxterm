/**
 * Orchestrates prompt enhancement: privacy gates, provider priority, real
 * reachability tests, and the bounded project-context attachment.
 *
 * Privacy rules enforced here:
 * - {@link resolveLocalOnly} is the single source of truth for whether cloud
 *   providers may be contacted (privacy.localOnlyMode OR prompts.localOnly).
 * - Project context is attached only when settings.prompts.projectContext is
 *   enabled — that flag IS the consent — and a cwd was provided. A blocked or
 *   skipped provider never sees it.
 * - The transcript never reaches the activity log or the file log, and no
 *   status or attempt message ever contains a stored secret (server-supplied
 *   text is scrubbed before it leaves the provider layer, and again here).
 */
import type { Settings } from '@shared/schemas'
import type {
  PromptAttempt,
  PromptEnhanceResult,
  PromptProviderId,
  PromptProviderStatus
} from '@shared/types'
import type { Logger } from '../util/logger'
import { ENHANCE_SYSTEM_PROMPT, buildUserContent, collectProjectContext } from './instructions'
import {
  DEFAULT_PROVIDER_BASE_URLS,
  PROVIDERS,
  type ProviderCompleteResult,
  type ProviderConfig,
  type ProviderContext
} from './providers'

export interface PromptServiceDeps {
  getSettings: () => Settings
  getSecret: (slot: 'google') => string | null
  logger: Logger
  fetchImpl?: typeof fetch
}

/** Privacy gate shared by every decision in this module. */
export function resolveLocalOnly(settings: Settings): boolean {
  return settings.privacy.localOnlyMode || settings.prompts.localOnly
}

/** Short enough that the Settings page stays snappy on slow networks. */
const STATUS_TIMEOUT_MS = 4000

/** Every provider id in the fallback order. */
const ALL_PROVIDER_IDS: readonly PromptProviderId[] = ['ollama', 'google']

/**
 * Priority order first, then any provider the priority array omits — per
 * settings semantics, `enabled` selects providers while `priority` only orders
 * them. De-duplicated so a repeated id is never tried twice.
 */
function providerOrder(settings: Settings): PromptProviderId[] {
  const seen = new Set<PromptProviderId>()
  const order: PromptProviderId[] = []
  for (const id of [...settings.prompts.priority, ...ALL_PROVIDER_IDS]) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  return order
}

export class PromptService {
  constructor(private readonly deps: PromptServiceDeps) {}

  /**
   * One entry per provider, arranged in priority order. Network-backed and
   * bounded to {@link STATUS_TIMEOUT_MS} per provider (all providers are
   * probed in parallel); disabled or privacy-blocked providers are answered
   * deterministically without any request.
   */
  async statuses(): Promise<PromptProviderStatus[]> {
    const settings = this.deps.getSettings()
    const localOnly = resolveLocalOnly(settings)
    const ctx = this.context(STATUS_TIMEOUT_MS)
    return Promise.all(
      providerOrder(settings).map((id) => this.describe(id, settings, localOnly, ctx, true))
    )
  }

  /** Real single-provider test at the full configured request timeout. */
  async test(id: PromptProviderId): Promise<PromptProviderStatus> {
    const settings = this.deps.getSettings()
    const localOnly = resolveLocalOnly(settings)
    const ctx = this.context(settings.prompts.timeoutSeconds * 1000)
    // An explicit test runs even for a disabled provider (the user asked for
    // it), but never for a provider the current privacy mode forbids.
    return this.describe(id, settings, localOnly, ctx, false)
  }

  /**
   * Try every allowed provider in priority order, first success wins. On
   * total failure the original transcript is preserved in BOTH `original`
   * and `enhanced`, so the UI can offer "continue without enhancement".
   */
  async enhance(args: { text: string; cwd?: string }): Promise<PromptEnhanceResult> {
    const started = Date.now()
    const text = args.text.trim()
    if (text.length === 0) {
      return {
        ok: false,
        provider: null,
        original: text,
        enhanced: text,
        usedProjectContext: false,
        attempts: [],
        ms: Date.now() - started,
        error: 'There is no transcript text to enhance.'
      }
    }

    const settings = this.deps.getSettings()
    const localOnly = resolveLocalOnly(settings)
    const ctx = this.context(settings.prompts.timeoutSeconds * 1000)

    // Consent + cwd required; without either, no context is ever collected.
    let context: string | null = null
    const wantsContext =
      settings.prompts.projectContext && typeof args.cwd === 'string' && args.cwd.trim().length > 0
    if (wantsContext && typeof args.cwd === 'string') {
      context = await collectProjectContext(args.cwd)
    }

    const attempts: PromptAttempt[] = []
    let providerCalls = 0
    let usedProjectContext = false

    for (const id of providerOrder(settings)) {
      const config = this.configFor(settings, id)
      if (!config.enabled) {
        attempts.push({ id, ok: false, message: 'Skipped: provider is disabled in settings.' })
        continue
      }
      if (localOnly && id !== 'ollama') {
        attempts.push({ id, ok: false, message: 'blocked by local-only mode' })
        continue
      }
      if (id !== 'ollama' && !this.deps.getSecret(id)) {
        attempts.push({ id, ok: false, message: 'Skipped: no API key is stored for this provider.' })
        continue
      }
      const endpoint = config.baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[id]
      if (endpoint.length === 0) {
        attempts.push({ id, ok: false, message: 'Skipped: no endpoint is configured.' })
        continue
      }

      providerCalls += 1
      if (context !== null) usedProjectContext = true
      const user = buildUserContent(text, context)
      let result: ProviderCompleteResult
      try {
        result = await PROVIDERS[id].complete({ config, system: ENHANCE_SYSTEM_PROMPT, user }, ctx)
      } catch (error) {
        // Provider code is written never to throw; keep the loop alive anyway.
        const detail = error instanceof Error ? error.message : String(error)
        attempts.push({ id, ok: false, message: this.scrubSecrets(id, `Provider failed: ${detail}`) })
        continue
      }
      const ok = result.ok && result.text.trim().length > 0
      const message = this.scrubSecrets(
        id,
        ok ? result.message : result.ok ? 'Provider returned empty text.' : result.message
      )
      attempts.push({ id, ok, message })
      if (ok) {
        this.deps.logger.debug('prompts', `Enhanced via ${id} (${Date.now() - started} ms)`)
        return {
          ok: true,
          provider: id,
          original: text,
          enhanced: result.text.trim(),
          usedProjectContext,
          attempts,
          ms: Date.now() - started
        }
      }
    }

    this.deps.logger.warn(
      'prompts',
      `Enhancement failed: ${attempts.length} attempt(s), ${providerCalls} provider call(s)`
    )
    const refused = attempts.length > 0 && providerCalls === 0
    return {
      ok: false,
      provider: null,
      original: text,
      enhanced: text,
      usedProjectContext,
      attempts,
      ms: Date.now() - started,
      error:
        attempts.length === 0
          ? 'No prompt provider is listed in the priority order.'
          : refused
            ? 'No prompt provider was allowed or configured.'
            : 'All prompt providers failed.',
      ...(refused ? { blocked: true } : {})
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async describe(
    id: PromptProviderId,
    settings: Settings,
    localOnly: boolean,
    ctx: ProviderContext,
    skipDisabled: boolean
  ): Promise<PromptProviderStatus> {
    const config = this.configFor(settings, id)
    const allowed = !localOnly || id === 'ollama'
    const endpoint = config.baseUrl.trim() || DEFAULT_PROVIDER_BASE_URLS[id]
    const hasKey = id === 'ollama' || this.deps.getSecret(id) !== null
    const base: PromptProviderStatus = {
      id,
      enabled: config.enabled,
      allowed,
      configured: endpoint.length > 0 && hasKey && config.model.trim().length > 0,
      reachable: false,
      model: config.model.trim() || null,
      message: '',
      ms: null
    }
    // Never contact a provider the privacy mode forbids, and never probe one
    // the user disabled when refreshing the list.
    if (!allowed) return { ...base, message: 'Blocked by local-only mode.' }
    if (skipDisabled && !config.enabled) return { ...base, message: 'Disabled in settings.' }

    const started = Date.now()
    try {
      const result = await PROVIDERS[id].test(config, ctx)
      return {
        ...base,
        reachable: result.reachable,
        model: result.model ?? base.model,
        message: this.scrubSecrets(id, result.message),
        ms: Date.now() - started
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        ...base,
        message: this.scrubSecrets(id, `Provider test failed: ${detail.slice(0, 200)}`),
        ms: Date.now() - started
      }
    }
  }

  private configFor(settings: Settings, id: PromptProviderId): ProviderConfig {
    const provider = settings.prompts[id]
    return { enabled: provider.enabled, baseUrl: provider.baseUrl, model: provider.model }
  }

  private context(timeoutMs: number): ProviderContext {
    return {
      fetchImpl: this.deps.fetchImpl ?? globalThis.fetch,
      timeoutMs,
      getSecret: (slot) => this.deps.getSecret(slot)
    }
  }

  /** Second scrubbing layer: no stored secret may ever appear in a message. */
  private scrubSecrets(id: PromptProviderId, message: string): string {
    if (id === 'ollama') return message
    const secret = this.deps.getSecret(id)
    if (!secret || secret.length < 4) return message
    return message.split(secret).join('<redacted>')
  }
}
