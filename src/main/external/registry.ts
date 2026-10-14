import type {
  AttachExternalResult,
  ExternalProviderInfo,
  ExternalSessionInfo,
  OperationResult
} from '@shared/types'
import type { ExternalStatusResult } from '@shared/api'
import type { Settings } from '@shared/schemas'
import { withTimeout, type ExternalProvider, type ProviderContext } from './provider'

const DISCOVERY_TIMEOUT_MS = 8000

export interface ExternalRegistryDeps {
  context: ProviderContext
  getSettings: () => Settings
  onSessionsChanged: (sessions: ExternalSessionInfo[]) => void
  onProviderError: (providerId: string, message: string) => void
}

/**
 * Aggregates external-terminal providers, isolates their failures, and drives
 * periodic + on-demand discovery. A provider that hangs or errors never blocks
 * or crashes the rest of the inventory.
 */
export class ExternalSessionRegistry {
  private sessions: ExternalSessionInfo[] = []
  private providerErrors = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<ExternalSessionInfo[]> | null = null

  constructor(
    private readonly providers: ExternalProvider[],
    private readonly deps: ExternalRegistryDeps
  ) {}

  getProviders(): ExternalProviderInfo[] {
    return this.providers.map((provider) => provider.info())
  }

  list(): ExternalSessionInfo[] {
    return [...this.sessions]
  }

  private enabledProviders(settings: Settings): ExternalProvider[] {
    const enabled = settings.external.enabledProviders
    return this.providers.filter((provider) => enabled.length === 0 || enabled.includes(provider.id))
  }

  /** Probe availability and run discovery across every enabled provider. */
  async refresh(): Promise<ExternalSessionInfo[]> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runRefresh(): Promise<ExternalSessionInfo[]> {
    const settings = this.deps.getSettings()
    const providers = this.enabledProviders(settings)
    const collected: ExternalSessionInfo[] = []

    await Promise.all(
      providers.map(async (provider) => {
        try {
          await withTimeout(provider.probe(this.deps.context), 4000, `${provider.name} probe`)
        } catch (error) {
          this.reportProviderError(provider.id, error instanceof Error ? error.message : String(error))
          return
        }
        if (!provider.info().available) return
        try {
          const found = await withTimeout(
            provider.discover(this.deps.context),
            DISCOVERY_TIMEOUT_MS,
            `${provider.name} discovery`
          )
          collected.push(...found)
          this.providerErrors.delete(provider.id)
        } catch (error) {
          this.reportProviderError(provider.id, error instanceof Error ? error.message : String(error))
        }
      })
    )

    collected.sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId)
      return a.name.localeCompare(b.name)
    })

    this.sessions = collected
    this.deps.onSessionsChanged(this.sessions)
    return this.sessions
  }

  private reportProviderError(providerId: string, message: string): void {
    if (this.providerErrors.get(providerId) === message) return
    this.providerErrors.set(providerId, message)
    this.deps.onProviderError(providerId, message)
  }

  private split(fullId: string): { providerId: string; externalId: string } | null {
    const index = fullId.indexOf(':')
    if (index <= 0) return null
    return { providerId: fullId.slice(0, index), externalId: fullId.slice(index + 1) }
  }

  private findProvider(providerId: string): ExternalProvider | undefined {
    return this.providers.find((provider) => provider.id === providerId)
  }

  async attach(fullId: string): Promise<AttachExternalResult> {
    const parts = this.split(fullId)
    if (!parts) return { ok: false, state: 'unsupported', message: 'Malformed session id.' }
    const provider = this.findProvider(parts.providerId)
    if (!provider) return { ok: false, state: 'unsupported', message: `Unknown provider "${parts.providerId}".` }
    if (!provider.info().available) {
      return { ok: false, state: 'unsupported', message: provider.info().reason ?? 'Provider unavailable.' }
    }
    if (!provider.capabilities.attach) {
      return {
        ok: false,
        state: 'unsupported',
        message: `${provider.name} discovery is supported, but attaching is not available on this platform.`
      }
    }
    let result: AttachExternalResult
    try {
      result = await withTimeout(provider.attach(parts.externalId, this.deps.context), 10000, 'attach')
    } catch (error) {
      result = {
        ok: false,
        state: 'attach_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    await this.refresh().catch(() => undefined)
    return result
  }

  async detach(fullId: string): Promise<OperationResult> {
    const parts = this.split(fullId)
    if (!parts) return { ok: false, code: 'bad-id', message: 'Malformed session id.' }
    const provider = this.findProvider(parts.providerId)
    if (!provider || !provider.capabilities.detach) {
      return { ok: false, code: 'unsupported', message: 'This integration cannot detach.' }
    }
    const result = await provider
      .detach(parts.externalId, this.deps.context)
      .catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }))
    await this.refresh().catch(() => undefined)
    return result
  }

  async terminate(fullId: string): Promise<OperationResult> {
    const parts = this.split(fullId)
    if (!parts) return { ok: false, code: 'bad-id', message: 'Malformed session id.' }
    const provider = this.findProvider(parts.providerId)
    if (!provider || !provider.capabilities.terminate) {
      return { ok: false, code: 'unsupported', message: 'This integration cannot terminate sessions.' }
    }
    const result = await provider
      .terminate(parts.externalId, this.deps.context)
      .catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }))
    await this.refresh().catch(() => undefined)
    return result
  }

  async status(fullId: string): Promise<ExternalStatusResult> {
    const parts = this.split(fullId)
    if (!parts) {
      return { id: fullId, state: 'unsupported', detail: 'Malformed session id.' }
    }
    const provider = this.findProvider(parts.providerId)
    if (!provider) {
      return { id: fullId, state: 'unsupported', detail: `Unknown provider "${parts.providerId}".` }
    }
    try {
      return await withTimeout(provider.getStatus(parts.externalId, this.deps.context), 5000, 'status')
    } catch (error) {
      return {
        id: fullId,
        state: 'unsupported',
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /** (Re)start the periodic discovery loop from current settings. */
  configure(): void {
    this.stop()
    const settings = this.deps.getSettings()
    if (!settings.external.discoveryEnabled) return
    const interval = Math.max(2000, settings.external.discoveryIntervalMs)
    this.timer = setInterval(() => {
      void this.refresh()
    }, interval)
    this.timer.unref?.()
  }

  start(): void {
    this.configure()
    void this.refresh()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
