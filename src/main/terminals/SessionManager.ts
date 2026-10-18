import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { IPty } from 'node-pty'
import type { CreateTerminalOptions, SessionOrigin, TerminalSessionInfo } from '@shared/types'
import type { Settings } from '@shared/schemas'
import { resolveShell, resolveStartupDirectory } from './shell'
import { findExecutable } from '../util/exec'
import type { Logger } from '../util/logger'

const MAX_PENDING_BUFFER = 256 * 1024
const MAX_SNAPSHOT_BUFFER = 256 * 1024

export interface TerminalSessionEvents {
  data: { sessionId: string; data: string }
  exit: { sessionId: string; exitCode: number | null; signal: number | null }
  title: { sessionId: string; title: string }
  session: TerminalSessionInfo
  list: TerminalSessionInfo[]
}

interface ManagedSession {
  info: TerminalSessionInfo
  pty: IPty
  pending: string
  snapshot: string
  subscribed: boolean
  titleLocked: boolean
  terminating: boolean
  exitResolvers: Array<() => void>
}

export interface CreateSessionContext {
  /** Explicit working directory override. */
  cwd?: string
}

export interface SessionManagerDeps {
  logger: Logger
  getSettings: () => Settings
  resolvePath: () => Promise<string>
  onSessionEvent?: (event: TerminalSessionEvents['session']) => void
}

/**
 * Owns every VoxTerm-managed pseudo-terminal. Sessions are keyed by a stable
 * UUID independent of any tab position, so switching tabs never restarts a
 * shell and commands are always routed by id.
 */
export class TerminalSessionManager {
  private sessions = new Map<string, ManagedSession>()
  private listeners: { [K in keyof TerminalSessionEvents]: Set<(payload: TerminalSessionEvents[K]) => void> } = {
    data: new Set(),
    exit: new Set(),
    title: new Set(),
    session: new Set(),
    list: new Set()
  }
  private counter = 0

  constructor(private readonly deps: SessionManagerDeps) {}

  on<K extends keyof TerminalSessionEvents>(
    event: K,
    listener: (payload: TerminalSessionEvents[K]) => void
  ): () => void {
    this.listeners[event].add(listener)
    return () => this.listeners[event].delete(listener)
  }

  private emit<K extends keyof TerminalSessionEvents>(event: K, payload: TerminalSessionEvents[K]): void {
    for (const listener of this.listeners[event]) {
      try {
        listener(payload)
      } catch (error) {
        this.deps.logger.warn('terminal', `Listener for "${String(event)}" threw: ${String(error)}`)
      }
    }
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => ({ ...session.info }))
  }

  get(id: string): TerminalSessionInfo | null {
    const session = this.sessions.get(id)
    return session ? { ...session.info } : null
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  async create(options: CreateTerminalOptions = {}, context: CreateSessionContext = {}): Promise<TerminalSessionInfo> {
    const settings = this.deps.getSettings()
    const pathValue = await this.deps.resolvePath()

    // Attached multiplexer sessions run the multiplexer *client* itself. The
    // command is built here from validated fields — the renderer can never pass
    // arbitrary argv, and closing the tab only detaches our client.
    let shell: { path: string; name: string }
    let args: string[]
    if (options.attach) {
      const { kind, name, target, busy } = options.attach
      const binary = await findExecutable(kind, pathValue)
      if (!binary) {
        throw new Error(`${kind} was not found on PATH; install it or disable external discovery.`)
      }
      shell = { path: binary, name: kind }
      // Prefer the exact identifier discovery reported: tmux parses `-t` as
      // `session:window.pane`, so names with `.` or `:` never resolve by name.
      const identifier = target?.trim() || name
      if (kind === 'tmux') {
        // No `-d` anywhere: it would detach every other client from the session.
        args = ['attach-session', '-t', identifier]
      } else {
        // `-r` only works on a detached session; a busy one needs shared mode
        // (`-x`), which joins without disconnecting the existing client.
        // `-d`/`-D` would kick that client, so they are never used.
        args = busy ? ['-x', identifier] : ['-r', identifier]
      }
    } else {
      shell = await resolveShell(options.shell ?? settings.terminal.defaultShell, pathValue)
      args = options.args ?? []
    }

    const origin: SessionOrigin = options.attach
      ? { kind: options.attach.kind, target: options.attach.name, detachOnly: true }
      : { kind: 'managed', detachOnly: false }

    const configuredStartup =
      settings.terminal.newTerminalBehavior === 'configured' ? settings.terminal.startupDirectory : ''
    const requestedCwd = context.cwd ?? options.cwd ?? configuredStartup
    const cwd = await resolveStartupDirectory(requestedCwd, homedir())

    const cols = clampDimension(options.cols, 80, 20, 1000)
    const rows = clampDimension(options.rows, 24, 5, 1000)

    // node-pty is a native module; require it lazily so a load failure is
    // reported cleanly instead of crashing the whole main process.
    let pty: typeof import('node-pty')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty') as typeof import('node-pty')
    } catch (error) {
      throw new Error(
        `Terminal backend unavailable: node-pty failed to load (${error instanceof Error ? error.message : String(error)})`,
        { cause: error }
      )
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      VOXTERM: '1',
      VOXTERM_SESSION_ID: '',
      PATH: pathValue || process.env.PATH || '',
      ...(options.env ?? {})
    }

    const id = randomUUID()
    env.VOXTERM_SESSION_ID = id

    let instance: IPty
    try {
      instance = pty.spawn(shell.path, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
        encoding: 'utf8'
      })
    } catch (error) {
      throw new Error(
        `Failed to start shell "${shell.path}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }

    this.counter += 1
    const now = Date.now()
    const info: TerminalSessionInfo = {
      id,
      title:
        options.title?.trim() ||
        (options.attach ? `${options.attach.kind}: ${options.attach.name}` : `${shell.name}`),
      shell: shell.path,
      shellName: shell.name,
      cwd,
      pid: instance.pid ?? null,
      cols,
      rows,
      status: 'running',
      exitCode: null,
      exitSignal: null,
      createdAt: now,
      lastActiveAt: now,
      origin
    }

    const session: ManagedSession = {
      info,
      pty: instance,
      pending: '',
      snapshot: '',
      subscribed: false,
      titleLocked: Boolean(options.title?.trim()),
      terminating: false,
      exitResolvers: []
    }
    this.sessions.set(id, session)

    instance.onData((data) => {
      session.snapshot = cap(session.snapshot + data, MAX_SNAPSHOT_BUFFER)
      if (!session.subscribed) {
        session.pending = cap(session.pending + data, MAX_PENDING_BUFFER)
        return
      }
      this.emit('data', { sessionId: id, data })
    })

    instance.onExit(({ exitCode, signal }) => {
      session.info.status = 'exited'
      session.info.exitCode = typeof exitCode === 'number' ? exitCode : null
      session.info.exitSignal = typeof signal === 'number' ? signal : null
      this.deps.logger.info('terminal', `Session ${id} exited (code=${exitCode ?? 'n/a'})`)
      this.emit('exit', {
        sessionId: id,
        exitCode: session.info.exitCode,
        signal: session.info.exitSignal
      })
      this.emit('session', { ...session.info })
      this.emitList()
      const resolvers = session.exitResolvers
      session.exitResolvers = []
      for (const resolve of resolvers) resolve()
    })

    const titled = instance as IPty & { onTitleChange?: (cb: (title: string) => void) => void }
    titled.onTitleChange?.((title: string) => {
      if (!session.titleLocked && title && title.trim()) {
        session.info.title = title.trim().slice(0, 120)
        this.emit('title', { sessionId: id, title: session.info.title })
        this.emit('session', { ...session.info })
      }
    })

    this.deps.logger.info('terminal', `Created session ${id} (${shell.name}, pid=${info.pid ?? 'n/a'})`)
    this.emit('session', { ...info })
    this.emitList()
    return { ...info }
  }

  /**
   * Mark a session active and return any output produced before the renderer
   * attached its listener. Idempotent: subsequent calls return an empty string.
   */
  subscribe(id: string): string {
    const session = this.sessions.get(id)
    if (!session) return ''
    session.info.lastActiveAt = Date.now()
    const pending = session.pending
    session.pending = ''
    session.subscribed = true
    return pending
  }

  /** Return the rolling output buffer regardless of subscription state. */
  snapshot(id: string): string {
    return this.sessions.get(id)?.snapshot ?? ''
  }

  write(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session || session.info.status !== 'running') return false
    session.info.lastActiveAt = Date.now()
    try {
      session.pty.write(data)
      return true
    } catch (error) {
      this.deps.logger.warn('terminal', `Write to session ${id} failed: ${String(error)}`)
      return false
    }
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    const safeCols = clampDimension(cols, session.info.cols, 2, 1000)
    const safeRows = clampDimension(rows, session.info.rows, 2, 1000)
    if (safeCols === session.info.cols && safeRows === session.info.rows) return true
    try {
      session.pty.resize(safeCols, safeRows)
      session.info.cols = safeCols
      session.info.rows = safeRows
      return true
    } catch (error) {
      this.deps.logger.warn('terminal', `Resize of session ${id} failed: ${String(error)}`)
      return false
    }
  }

  rename(id: string, title: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    const clean = title.trim().slice(0, 120)
    if (!clean) return false
    session.info.title = clean
    session.titleLocked = true
    this.emit('session', { ...session.info })
    return true
  }

  markActive(id: string): void {
    const session = this.sessions.get(id)
    if (session) session.info.lastActiveAt = Date.now()
  }

  /**
   * Terminate a session's process group. Sends SIGTERM to the group, waits for
   * exit, then escalates to SIGKILL. Never kills unrelated processes.
   */
  async terminate(id: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) return false
    if (session.info.status !== 'running') {
      this.sessions.delete(id)
      this.emitList()
      return true
    }
    session.terminating = true

    const exited = new Promise<void>((resolve) => {
      session.exitResolvers.push(resolve)
    })

    killGroup(session, signal)
    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(1500).then(() => true)
    ])
    if (timedOut) {
      this.deps.logger.warn('terminal', `Session ${id} ignored ${signal}; sending SIGKILL`)
      killGroup(session, 'SIGKILL')
      await Promise.race([exited, delay(1000)])
    }

    this.sessions.delete(id)
    this.emitList()
    return true
  }

  /** Terminate every managed session (application shutdown). */
  async terminateAll(signal: NodeJS.Signals = 'SIGHUP'): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map((id) => this.terminate(id, signal).catch(() => undefined)))
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      killGroup(session, 'SIGHUP')
    }
    this.sessions.clear()
    this.emitList()
  }

  /**
   * Drop all session references without signalling the processes. Used only
   * when the user has explicitly chosen to keep managed shells running on exit.
   */
  releaseAll(): void {
    this.sessions.clear()
    this.emitList()
  }

  private emitList(): void {
    this.emit('list', this.list())
  }
}

function clampDimension(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function cap(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(value.length - max)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * Signal the session's process group. Because forkpty puts the child in its
 * own session, `-pid` targets the shell and everything it started.
 */
function killGroup(session: ManagedSession, signal: NodeJS.Signals): void {
  const pid = session.info.pid
  if (pid && pid > 0) {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      /* fall through to the pty-level kill */
    }
  }
  try {
    session.pty.kill(signal)
  } catch {
    /* already gone */
  }
}
