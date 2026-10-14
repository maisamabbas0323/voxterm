import type {
  AttachExternalResult,
  ExternalSessionInfo,
  ExternalSessionState,
  OperationResult
} from '@shared/types'
import type { ExternalStatusResult } from '@shared/api'
import { findExecutable } from '../../util/exec'
import { BaseExternalProvider, type ProbeResult, type ProviderContext } from '../provider'

export interface ScreenSession {
  spec: string
  name: string
  pid: number
  attached: boolean
}

const SESSION_LINE = /^\s*(\d+)\.(\S+)\s+.*\((Attached|Detached)\)\s*$/i

export function parseSessions(stdout: string): ScreenSession[] {
  const sessions: ScreenSession[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '')
    const match = SESSION_LINE.exec(line)
    if (!match) continue
    const pid = Number.parseInt(match[1], 10)
    const name = match[2]
    sessions.push({
      spec: `${match[1]}.${name}`,
      name,
      pid,
      attached: match[3].toLowerCase() === 'attached'
    })
  }
  return sessions
}

/**
 * `screen` integration. Discovery and attachment are genuine, but screen only
 * permits joining an already-attached session with `-x`, so availability of
 * that path is reported honestly rather than assumed.
 */
export class ScreenExternalProvider extends BaseExternalProvider {
  readonly id = 'screen'
  readonly name = 'screen'
  readonly description = 'Discover and attach to GNU screen sessions.'
  override capabilities = {
    discover: true,
    inspect: true,
    attach: true,
    detach: true,
    terminate: true,
    getStatus: true
  }

  async probe(ctx: ProviderContext): Promise<ProbeResult> {
    const path = await findExecutable('screen', await ctx.resolvePath())
    this.resolvedPath = path
    this.available = Boolean(path)
    this.reason = path ? undefined : 'screen executable not found on PATH.'
    return { available: this.available, reason: this.reason, resolvedPath: path }
  }

  private get binary(): string {
    return this.resolvedPath ?? 'screen'
  }

  private connectedSession(spec: string, ctx: ProviderContext): string | undefined {
    return ctx.sessions
      .list()
      .find(
        (session) =>
          session.origin === 'external' &&
          session.providerId === this.id &&
          session.externalSessionId === spec &&
          session.status === 'running'
      )?.id
  }

  private async listSessions(ctx: ProviderContext): Promise<ScreenSession[]> {
    const result = await ctx.execFileSafe(this.binary, ['-ls'], { timeoutMs: 4000 })
    const combined = `${result.stdout}${result.stderr}`
    if (/no sockets found/i.test(combined)) return []
    if (!result.ok && result.code !== 1) {
      throw new Error(result.stderr.trim() || result.error || 'screen -ls failed')
    }
    return parseSessions(combined)
  }

  private toInfo(session: ScreenSession, ctx: ProviderContext): ExternalSessionInfo {
    const managedSessionId = this.connectedSession(session.spec, ctx)
    const state: ExternalSessionState = managedSessionId ? 'connected' : 'attachable'
    return {
      id: BaseExternalProvider.encodeId(this.id, session.spec),
      providerId: this.id,
      externalId: session.spec,
      name: session.name,
      state,
      pid: session.pid,
      cwd: null,
      windows: null,
      attachedClients: session.attached ? 1 : 0,
      createdAt: null,
      source: 'screen -ls',
      attachable: true,
      terminatable: true,
      managedSessionId,
      detail: session.attached
        ? 'Session is attached elsewhere; VoxTerm will try to join with "screen -x".'
        : undefined,
      detectedAt: Date.now()
    }
  }

  async discover(ctx: ProviderContext): Promise<ExternalSessionInfo[]> {
    if (!this.available) return []
    const sessions = await this.listSessions(ctx)
    return sessions.map((session) => this.toInfo(session, ctx))
  }

  override async attach(externalId: string, ctx: ProviderContext): Promise<AttachExternalResult> {
    const existing = this.connectedSession(externalId, ctx)
    if (existing) {
      return { ok: true, state: 'connected', managedSessionId: existing }
    }
    const sessions = await this.listSessions(ctx).catch(() => [])
    const target = sessions.find((session) => session.spec === externalId)
    if (!target) {
      return { ok: false, state: 'attach_failed', message: `screen session "${externalId}" was not found.` }
    }
    const flag = target.attached ? '-x' : '-r'
    try {
      const session = await ctx.sessions.create(
        {
          shell: this.binary,
          args: [flag, target.spec],
          title: `screen: ${target.name}`
        },
        { origin: 'external', providerId: this.id, externalSessionId: externalId }
      )
      return { ok: true, state: 'connected', managedSessionId: session.id }
    } catch (error) {
      return {
        ok: false,
        state: 'attach_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  override async detach(externalId: string, ctx: ProviderContext): Promise<OperationResult> {
    const managedSessionId = this.connectedSession(externalId, ctx)
    if (!managedSessionId) {
      return { ok: false, code: 'not-connected', message: 'VoxTerm is not attached to this session.' }
    }
    await ctx.sessions.terminate(managedSessionId, 'SIGHUP')
    return { ok: true, message: `Detached from screen session "${externalId}".` }
  }

  override async terminate(externalId: string, ctx: ProviderContext): Promise<OperationResult> {
    const result = await ctx.execFileSafe(this.binary, ['-S', externalId, '-X', 'quit'], { timeoutMs: 4000 })
    if (!result.ok) {
      return {
        ok: false,
        code: 'terminate-failed',
        message: result.stderr.trim() || result.error || 'screen quit failed'
      }
    }
    const managedSessionId = this.connectedSession(externalId, ctx)
    if (managedSessionId) {
      await ctx.sessions.terminate(managedSessionId, 'SIGHUP').catch(() => undefined)
    }
    return { ok: true, message: `Terminated screen session "${externalId}".` }
  }

  override async getStatus(externalId: string, ctx: ProviderContext): Promise<ExternalStatusResult> {
    const id = BaseExternalProvider.encodeId(this.id, externalId)
    if (!this.available) {
      return { id, state: 'unsupported', detail: this.reason }
    }
    const sessions = await this.listSessions(ctx).catch(() => [])
    const exists = sessions.some((session) => session.spec === externalId)
    const managedSessionId = this.connectedSession(externalId, ctx)
    const state: ExternalSessionState = !exists ? 'exited' : managedSessionId ? 'connected' : 'attachable'
    return { id, state, managedSessionId, detail: exists ? undefined : 'screen session not found.' }
  }
}
