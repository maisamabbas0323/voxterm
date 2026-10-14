import type {
  AttachExternalResult,
  ExternalSessionInfo,
  ExternalSessionState,
  OperationResult
} from '@shared/types'
import type { ExternalStatusResult } from '@shared/api'
import { findExecutable } from '../../util/exec'
import { BaseExternalProvider, type ProbeResult, type ProviderContext } from '../provider'

const FORMAT = '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}|#{session_path}'

export interface TmuxSession {
  name: string
  windows: number
  created: number
  attached: number
  path: string
}

export function parseSessions(stdout: string): TmuxSession[] {
  const sessions: TmuxSession[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name, windows, created, attached, ...rest] = line.split('|')
    if (!name) continue
    sessions.push({
      name,
      windows: Number.parseInt(windows, 10) || 0,
      created: Number.parseInt(created, 10) || 0,
      attached: Number.parseInt(attached, 10) || 0,
      path: rest.join('|')
    })
  }
  return sessions
}

/**
 * Genuine `tmux` integration. VoxTerm can discover persistent tmux sessions,
 * attach a real client through a PTY (so both VoxTerm and an external terminal
 * can view the same session), detach without killing it, and terminate it
 * through tmux itself.
 */
export class TmuxExternalProvider extends BaseExternalProvider {
  readonly id = 'tmux'
  readonly name = 'tmux'
  readonly description = 'Attach to persistent tmux sessions over a shared server.'
  override capabilities = {
    discover: true,
    inspect: true,
    attach: true,
    detach: true,
    terminate: true,
    getStatus: true
  }

  async probe(ctx: ProviderContext): Promise<ProbeResult> {
    const path = await findExecutable('tmux', await ctx.resolvePath())
    this.resolvedPath = path
    this.available = Boolean(path)
    this.reason = path ? undefined : 'tmux executable not found on PATH.'
    return { available: this.available, reason: this.reason, resolvedPath: path }
  }

  private get binary(): string {
    return this.resolvedPath ?? 'tmux'
  }

  private connectedSession(name: string, ctx: ProviderContext): string | undefined {
    return ctx.sessions
      .list()
      .find(
        (session) =>
          session.origin === 'external' &&
          session.providerId === this.id &&
          session.externalSessionId === name &&
          session.status === 'running'
      )?.id
  }

  private toInfo(session: TmuxSession, ctx: ProviderContext): ExternalSessionInfo {
    const managedSessionId = this.connectedSession(session.name, ctx)
    const state: ExternalSessionState = managedSessionId ? 'connected' : 'attachable'
    return {
      id: BaseExternalProvider.encodeId(this.id, session.name),
      providerId: this.id,
      externalId: session.name,
      name: session.name,
      state,
      pid: null,
      cwd: session.path && session.path.trim() ? session.path : null,
      windows: session.windows,
      attachedClients: session.attached,
      createdAt: session.created > 0 ? session.created * 1000 : null,
      source: 'tmux list-sessions',
      attachable: true,
      terminatable: true,
      managedSessionId,
      detail:
        session.attached > 0
          ? `Attached by ${session.attached} other client${session.attached === 1 ? '' : 's'}.`
          : undefined,
      detectedAt: Date.now()
    }
  }

  async discover(ctx: ProviderContext): Promise<ExternalSessionInfo[]> {
    if (!this.available) return []
    const result = await ctx.execFileSafe(this.binary, ['list-sessions', '-F', FORMAT], { timeoutMs: 4000 })
    if (!result.ok) {
      const combined = `${result.stderr}${result.stdout}`
      // "no server running" / "error connecting" simply means there are none.
      if (/no server running|error connecting|no such file or directory/i.test(combined) || result.code === 1) {
        return []
      }
      throw new Error(result.stderr.trim() || result.error || 'tmux list-sessions failed')
    }
    return parseSessions(result.stdout).map((session) => this.toInfo(session, ctx))
  }

  override async attach(externalId: string, ctx: ProviderContext): Promise<AttachExternalResult> {
    const existing = this.connectedSession(externalId, ctx)
    if (existing) {
      return { ok: true, state: 'connected', managedSessionId: existing }
    }
    try {
      const session = await ctx.sessions.create(
        {
          shell: this.binary,
          args: ['attach-session', '-t', externalId],
          title: `tmux: ${externalId}`
        },
        {
          origin: 'external',
          providerId: this.id,
          externalSessionId: externalId
        }
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
    // Killing the client PTY sends SIGHUP to the tmux client, which detaches
    // the client while the underlying tmux session keeps running.
    await ctx.sessions.terminate(managedSessionId, 'SIGHUP')
    return { ok: true, message: `Detached from tmux session "${externalId}".` }
  }

  override async terminate(externalId: string, ctx: ProviderContext): Promise<OperationResult> {
    const result = await ctx.execFileSafe(this.binary, ['kill-session', '-t', externalId], { timeoutMs: 4000 })
    if (!result.ok) {
      return {
        ok: false,
        code: 'terminate-failed',
        message: result.stderr.trim() || result.error || 'tmux kill-session failed'
      }
    }
    // Our own attached client (if any) will exit on its own; make sure it does.
    const managedSessionId = this.connectedSession(externalId, ctx)
    if (managedSessionId) {
      await ctx.sessions.terminate(managedSessionId, 'SIGHUP').catch(() => undefined)
    }
    return { ok: true, message: `Terminated tmux session "${externalId}".` }
  }

  override async getStatus(externalId: string, ctx: ProviderContext): Promise<ExternalStatusResult> {
    const id = BaseExternalProvider.encodeId(this.id, externalId)
    if (!this.available) {
      return { id, state: 'unsupported', detail: this.reason }
    }
    const managedSessionId = this.connectedSession(externalId, ctx)
    const result = await ctx.execFileSafe(
      this.binary,
      ['has-session', '-t', externalId],
      { timeoutMs: 3000 }
    )
    const exists = result.ok
    const state: ExternalSessionState = !exists
      ? 'exited'
      : managedSessionId
        ? 'connected'
        : 'attachable'
    return { id, state, managedSessionId, detail: exists ? undefined : 'tmux session not found.' }
  }
}
