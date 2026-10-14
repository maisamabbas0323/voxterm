import type {
  AttachExternalResult,
  ExternalProviderCapabilities,
  ExternalProviderInfo,
  ExternalSessionInfo,
  OperationResult
} from '@shared/types'
import type { ExternalStatusResult } from '@shared/api'
import type { TerminalSessionManager } from '../terminals/SessionManager'
import type { Logger } from '../util/logger'
import type { Settings } from '@shared/schemas'
import type { execFileSafe } from '../util/exec'

export interface ProviderContext {
  execFileSafe: typeof execFileSafe
  logger: Logger
  resolvePath: () => Promise<string>
  sessions: TerminalSessionManager
  getSettings: () => Settings
}

export interface ProbeResult {
  available: boolean
  reason?: string
  resolvedPath: string | null
}

/**
 * Contract every external-terminal integration must satisfy. The states and
 * capabilities are deliberately granular so the UI can never present a
 * detected window as a controllable session.
 */
export interface ExternalProvider {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly capabilities: ExternalProviderCapabilities
  /** Re-check whether the underlying tool is present. */
  probe(ctx: ProviderContext): Promise<ProbeResult>
  /** Snapshot of the current provider state, including availability. */
  info(): ExternalProviderInfo
  discover(ctx: ProviderContext): Promise<ExternalSessionInfo[]>
  attach(externalId: string, ctx: ProviderContext): Promise<AttachExternalResult>
  detach(externalId: string, ctx: ProviderContext): Promise<OperationResult>
  terminate(externalId: string, ctx: ProviderContext): Promise<OperationResult>
  getStatus(externalId: string, ctx: ProviderContext): Promise<ExternalStatusResult>
}

const DEFAULT_CAPABILITIES: ExternalProviderCapabilities = {
  discover: true,
  inspect: true,
  attach: false,
  detach: false,
  terminate: false,
  getStatus: true
}

/**
 * Shared plumbing for providers: availability bookkeeping and default
 * responses for operations a provider does not genuinely support.
 */
export abstract class BaseExternalProvider implements ExternalProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly description: string
  capabilities: ExternalProviderCapabilities = { ...DEFAULT_CAPABILITIES }

  protected available = false
  protected reason: string | undefined
  protected resolvedPath: string | null = null

  abstract probe(ctx: ProviderContext): Promise<ProbeResult>
  abstract discover(ctx: ProviderContext): Promise<ExternalSessionInfo[]>

  info(): ExternalProviderInfo {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      available: this.available,
      reason: this.reason,
      capabilities: { ...this.capabilities }
    }
  }

  isAvailable(): boolean {
    return this.available
  }

  /** Composite ids are `${providerId}:${externalId}`. */
  static encodeId(providerId: string, externalId: string): string {
    return `${providerId}:${externalId}`
  }

  protected unsupported(operation: string): OperationResult {
    return {
      ok: false,
      code: 'unsupported',
      message: `${this.name} integration does not support ${operation}.`
    }
  }

  async attach(_externalId: string, _ctx: ProviderContext): Promise<AttachExternalResult> {
    return {
      ok: false,
      state: 'unsupported',
      message: this.unsupported('attaching to a session').message
    }
  }

  async detach(_externalId: string, _ctx: ProviderContext): Promise<OperationResult> {
    return this.unsupported('detaching from a session')
  }

  async terminate(_externalId: string, _ctx: ProviderContext): Promise<OperationResult> {
    return this.unsupported('terminating a session')
  }

  async getStatus(externalId: string, _ctx: ProviderContext): Promise<ExternalStatusResult> {
    return {
      id: BaseExternalProvider.encodeId(this.id, externalId),
      state: this.available ? 'detected' : 'unsupported',
      detail: this.available ? undefined : this.reason
    }
  }
}

/** Run a promise with a hard timeout so a hung external tool cannot freeze the app. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
