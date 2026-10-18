import type {
  ExternalDiscovery,
  ExternalDiscoveryResult,
  ExternalSession,
  ExternalSessionKind
} from '@shared/types'
import type { Settings } from '@shared/schemas'
import { execFileSafe, findExecutable } from '../util/exec'
import type { Logger } from '../util/logger'

export interface ExternalDiscoveryDeps {
  getSettings: () => Settings
  resolvePath: () => Promise<string>
  logger: Logger
}

/**
 * Format string passed to `tmux list-sessions -F`. NOTE: the `\t` below are
 * real tab characters — tmux does NOT expand backslash escapes inside -F
 * format strings (verified against tmux 3.7b), so the string must contain
 * literal tabs for the parser to see tab-separated fields.
 *
 * `#{session_id}` (the trailing field) is the only target tmux resolves
 * unconditionally: `-t` is parsed as `session:window.pane`, so names containing
 * `.` or `:` cannot be targeted by name, while `$N` is matched first.
 */
export const TMUX_LIST_FORMAT =
  '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_id}'

const DISCOVER_TIMEOUT_MS = 4000

/**
 * Output patterns that mean "the multiplexer is installed and healthy, there
 * is simply nothing to list". These must never be reported as errors:
 *
 * - tmux with no running server (tmux 3.x): "no server running on <socket>";
 *   tmux 3.7b on a never-existing socket instead prints
 *   "error connecting to <socket> (No such file or directory)".
 * - screen with no sockets: "No Sockets found in <dir>." (exit code 1).
 */
const NO_SESSIONS_PATTERN: Record<ExternalSessionKind, RegExp> = {
  tmux: /no server running|error connecting/i,
  screen: /no sockets found/i
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * tmux renders a session id as `$N`. Anything else in that field would be
 * malformed output, in which case the display name is used as the target.
 */
function parseSessionId(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^\$\d+$/.test(trimmed) ? trimmed : null
}

/**
 * PURE parser for
 * `tmux list-sessions -F '<name>\t<windows>\t<attached>\t<created>\t<id>'`.
 * Real output (verified with tmux 3.7b, including sessions named with spaces,
 * dots and colons):
 *
 *   probe\t2\t0\t1700000000\t$1
 *   work space\t1\t1\t1690000000\t$2
 *
 * Malformed lines are skipped rather than thrown on. `session_created` is
 * seconds since the epoch and is converted to milliseconds.
 */
export function parseTmuxSessions(stdout: string): ExternalSession[] {
  const sessions: ExternalSession[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue
    const fields = line.split('\t')
    // Every valid -F line has at least four fields; anything else is not
    // list-sessions output (banners, "no server running", garbage, ...).
    if (fields.length < 4) continue
    const name = fields[0]
    if (!name) continue
    const windows = parseNonNegativeInt(fields[1])
    if (windows === null) continue
    const attachedClients = parseNonNegativeInt(fields[2])
    const createdSeconds = parseNonNegativeInt(fields[3])
    // -t is parsed as `session:window.pane`, so a name containing `.` or `:`
    // cannot be targeted by name; the `$N` session id (when reported) is the
    // only unconditionally-resolving target.
    const needsIdTarget = /[.:]/.test(name)
    const target = parseSessionId(fields[4])
    sessions.push({
      id: `tmux:${name}`,
      kind: 'tmux',
      name,
      target,
      windows,
      attachedClients,
      busy: (attachedClients ?? 0) > 0,
      createdAt: createdSeconds === null ? null : createdSeconds * 1000,
      attachable: true,
      ...(needsIdTarget
        ? {
            reason: target
              ? 'The name contains "." or ":"; attach uses its stable tmux session id instead of the name.'
              : 'The name contains "." or ":"; targeting it by name is ambiguous, attach by its session id when available.'
          }
        : {})
    })
  }
  return sessions
}

/**
 * Session lines look like "\t<pid>.<name>\t(<date>)\t(<status>)". The name
 * itself may contain dots (e.g. socket "83220.other.session"), so the pid is
 * split off at the FIRST dot only. The date column is optional in older
 * screen versions; the status is the trailing parenthesised field.
 */
const SCREEN_SESSION_LINE = /^\t?(\d+)\.([^\t]+)\t(.+)$/

function extractScreenStatus(fields: string[]): string | null {
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    const field = fields[index].trim()
    const match = /^\((.+)\)$/.exec(field)
    if (match && /(attached|detached|dead|removed|multi)/i.test(match[1])) {
      return match[1]
    }
  }
  return null
}

/**
 * PURE parser for `screen -ls`. Real output (verified with the system screen;
 * note the CRLF line endings), including dead sockets:
 *
 *   There are screens on:
 *   \t83220.other.session\t(10/17/2026 07:20:23 AM)\t(Detached)
 *   \t83175.probe\t(10/17/2026 07:20:23 AM)\t(Attached)
 *   \t83221.multi\t(10/17/2026 07:20:24 AM)\t(Multi, attached)
 *   2 Sockets in /tmp/screens.
 *
 *   \t84756.deadtest\t(???)\t(Remote or dead)      <- dead/removed socket
 *
 * Headers ("There is a screen on:", "There are several screens on:"),
 * footers ("N Socket(s) in ..."), "No Sockets found in ..." and garbage are
 * all skipped because they do not match the session-line shape. The date
 * column is the socket's modification time, NOT the creation time, so
 * `createdAt` stays null; `windows` is not reported by screen either.
 */
export function parseScreenSessions(stdout: string): ExternalSession[] {
  const sessions: ExternalSession[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue
    const match = SCREEN_SESSION_LINE.exec(line)
    if (!match) continue
    const name = match[2]
    if (!name) continue
    const status = extractScreenStatus(match[3].split('\t'))
    const multi = status !== null && /\bmulti/i.test(status)
    const dead = status !== null && /(dead|removed)/i.test(status)
    // screen never reports an exact client count; "(Multi, attached)" means
    // at least two clients, so 2 is recorded as the implied minimum.
    const attachedClients = multi ? 2 : null
    // `pid.name` is the socket itself, so it resolves even when two sessions
    // share a display name. A live status containing "attached" (this never
    // matches "Detached") means another client is already in the session.
    const busy = !dead && status !== null && /attached/i.test(status)
    const reason = dead
      ? `Screen reports this session as "${status}"; it cannot be attached.`
      : busy
        ? 'Another screen client is attached; VoxTerm joins in shared mode instead of disconnecting it.'
        : undefined
    sessions.push({
      id: `screen:${name}`,
      kind: 'screen',
      name,
      target: `${match[1]}.${name}`,
      windows: null,
      attachedClients,
      busy,
      createdAt: null,
      attachable: !dead,
      ...(reason ? { reason } : {})
    })
  }
  return sessions
}

function describeCount(kind: ExternalSessionKind, count: number): string {
  if (count === 0) return `No ${kind} sessions are running.`
  return `Found ${count} ${kind} session${count === 1 ? '' : 's'}.`
}

function firstLine(text: string | undefined): string {
  if (!text) return ''
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)
  return line ? line.trim().slice(0, 200) : ''
}

async function discoverKind(
  kind: ExternalSessionKind,
  userPath: string,
  logger: Logger
): Promise<ExternalDiscovery> {
  const binary = await findExecutable(kind, userPath)
  if (!binary) {
    logger.debug('external', `${kind} executable not found on the user PATH`)
    return { kind, available: false, message: `${kind} was not found on PATH.`, sessions: [] }
  }

  // Direct execFile, never a shell: session names are data, not syntax.
  const args = kind === 'tmux' ? ['list-sessions', '-F', TMUX_LIST_FORMAT] : ['-ls']
  const result = await execFileSafe(binary, args, { timeoutMs: DISCOVER_TIMEOUT_MS })
  // screen writes its -ls listing to stdout on modern versions and to stderr
  // on some older ones; the parsers skip anything that is not a session line,
  // so combining both streams is safe.
  const combined = `${result.stdout}\n${result.stderr}`
  const sessions = kind === 'tmux' ? parseTmuxSessions(result.stdout) : parseScreenSessions(combined)

  if (result.timedOut) {
    logger.debug('external', `${kind} listing timed out after ${DISCOVER_TIMEOUT_MS}ms`)
    return {
      kind,
      available: true,
      message: `${kind} did not respond within ${DISCOVER_TIMEOUT_MS / 1000} seconds.`,
      sessions: []
    }
  }

  if (result.code === null && result.error) {
    // Failed to spawn (e.g. the binary disappeared between lookup and exec).
    logger.debug('external', `${kind} failed to spawn: ${result.error}`)
    return { kind, available: false, message: `${kind} could not be executed.`, sessions: [] }
  }

  if (NO_SESSIONS_PATTERN[kind].test(combined)) {
    // Healthy multiplexer, nothing to list — honest zero, not an error.
    logger.debug('external', `${kind} reported no running sessions`)
    return { kind, available: true, message: `No ${kind} sessions are running.`, sessions: [] }
  }

  if (result.ok) {
    logger.debug('external', `${kind} reported ${sessions.length} session(s)`)
    return { kind, available: true, message: describeCount(kind, sessions.length), sessions }
  }

  if (sessions.length > 0) {
    // screen exits non-zero when sockets exist but every one is dead; the
    // list it printed is still genuine data (dead sessions parse as
    // attachable: false with a reason).
    logger.debug('external', `${kind} exited with code ${String(result.code)} but reported ${sessions.length} session(s)`)
    return { kind, available: true, message: describeCount(kind, sessions.length), sessions }
  }

  const detail = firstLine(result.stderr || result.stdout || result.error)
  logger.debug('external', `${kind} listing failed (code ${String(result.code)}): ${detail}`)
  return {
    kind,
    available: true,
    message: detail ? `${kind} session listing failed: ${detail}` : `${kind} session listing failed.`,
    sessions: []
  }
}

/**
 * Discover tmux/screen sessions, honouring the per-multiplexer settings
 * toggles. Binaries are resolved on the user's login-shell PATH; the listing
 * commands are executed directly (never through a shell) with a short timeout.
 */
export async function discoverExternalSessions(deps: ExternalDiscoveryDeps): Promise<ExternalDiscoveryResult> {
  const settings = deps.getSettings()
  const wanted: Array<{ kind: ExternalSessionKind; enabled: boolean }> = [
    { kind: 'tmux', enabled: settings.external.discoverTmux },
    { kind: 'screen', enabled: settings.external.discoverScreen }
  ]
  const enabledKinds = wanted.filter((entry) => entry.enabled).map((entry) => entry.kind)
  const results: ExternalDiscovery[] = []
  if (enabledKinds.length > 0) {
    const userPath = await deps.resolvePath()
    for (const kind of enabledKinds) {
      results.push(await discoverKind(kind, userPath, deps.logger))
    }
  }
  return { checkedAt: Date.now(), results }
}
