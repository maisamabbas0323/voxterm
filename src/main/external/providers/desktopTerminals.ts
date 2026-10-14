import { readdir, readFile, readlink } from 'node:fs/promises'
import type { ExternalSessionInfo } from '@shared/types'
import { BaseExternalProvider, type ProbeResult, type ProviderContext } from '../provider'

/** GUI terminal emulator processes we can identify by their executable name. */
const TERMINAL_EMULATORS = new Set([
  'gnome-terminal',
  'gnome-terminal-server',
  'konsole',
  'xterm',
  'urxvt',
  'rxvt',
  'alacritty',
  'kitty',
  'wezterm',
  'wezterm-gui',
  'terminator',
  'tilix',
  'xfce4-terminal',
  'mate-terminal',
  'lxterminal',
  'qterminal',
  'st',
  'hyper',
  'tabby',
  'foot',
  'ghostty'
])

/** Interactive shells that typically represent a live terminal session. */
const SHELLS = new Set(['bash', 'zsh', 'sh', 'dash', 'fish', 'ksh', 'ash'])

const MAX_RESULTS = 60

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readlinkSafe(path: string): Promise<string | null> {
  try {
    return await readlink(path)
  } catch {
    return null
  }
}

interface ProcEntry {
  pid: number
  comm: string
  cwd: string | null
  tty: string | null
  isVoxTerm: boolean
}

async function inspectProcess(pid: number): Promise<ProcEntry | null> {
  const commRaw = await readFileSafe(`/proc/${pid}/comm`)
  if (!commRaw) return null
  const comm = commRaw.trim()
  const isTerminal = TERMINAL_EMULATORS.has(comm)
  const isShell = SHELLS.has(comm)
  if (!isTerminal && !isShell) return null

  const environ = await readFileSafe(`/proc/${pid}/environ`)
  const isVoxTerm = Boolean(environ && environ.includes('VOXTERM_SESSION_ID'))

  const cwd = await readlinkSafe(`/proc/${pid}/cwd`)
  const ttyRaw = await readlinkSafe(`/proc/${pid}/fd/0`)
  const tty = ttyRaw && ttyRaw.startsWith('/dev/') ? ttyRaw : null

  return { pid, comm, cwd, tty, isVoxTerm }
}

/**
 * Linux-only discovery of terminal emulator processes and interactive shell
 * sessions that VoxTerm does not own.
 *
 * This provider deliberately does **not** claim attach capability. Linux offers
 * no portable mechanism to attach to another process's controlling terminal;
 * only multiplexers (tmux, screen) expose genuine attachment. The UI surfaces
 * these entries as detected-but-unsupported with that explanation.
 */
export class DesktopTerminalsExternalProvider extends BaseExternalProvider {
  readonly id = 'desktop-terminals'
  readonly name = 'Desktop terminals'
  readonly description = 'Detect terminal windows and shell sessions running outside VoxTerm.'
  override capabilities = {
    discover: true,
    inspect: true,
    attach: false,
    detach: false,
    terminate: false,
    getStatus: true
  }

  private supported(): boolean {
    return process.platform === 'linux'
  }

  async probe(_ctx: ProviderContext): Promise<ProbeResult> {
    this.available = this.supported()
    this.reason = this.available ? undefined : 'Process discovery is implemented for Linux only.'
    this.resolvedPath = null
    return { available: this.available, reason: this.reason, resolvedPath: null }
  }

  async discover(_ctx: ProviderContext): Promise<ExternalSessionInfo[]> {
    if (!this.available || !this.supported()) return []

    let entries: string[]
    try {
      entries = await readdir('/proc')
    } catch {
      return []
    }

    const pids = entries
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => Number.parseInt(entry, 10))
      .filter((pid) => pid !== process.pid)

    const results: ExternalSessionInfo[] = []
    // Bounded concurrency keeps discovery cheap even with hundreds of processes.
    const batchSize = 32
    for (let index = 0; index < pids.length && results.length < MAX_RESULTS; index += batchSize) {
      const batch = pids.slice(index, index + batchSize)
      const inspected = await Promise.all(batch.map((pid) => inspectProcess(pid)))
      for (const entry of inspected) {
        if (!entry || entry.isVoxTerm) continue
        const isEmulator = TERMINAL_EMULATORS.has(entry.comm)
        // A shell without a controlling TTY is not a terminal session.
        if (!isEmulator && !entry.tty) continue
        results.push(this.toInfo(entry, isEmulator))
        if (results.length >= MAX_RESULTS) break
      }
    }
    return results
  }

  private toInfo(entry: ProcEntry, isEmulator: boolean): ExternalSessionInfo {
    const identity = `${entry.comm} (pid ${entry.pid})`
    const detailParts: string[] = []
    if (entry.tty) detailParts.push(`TTY ${entry.tty}`)
    detailParts.push(
      isEmulator
        ? 'Terminal emulator process discovered via /proc.'
        : 'Interactive shell session discovered via /proc.'
    )
    detailParts.push(
      'Linux does not expose a portable API to attach to another program\u2019s controlling terminal; attach is supported for tmux and screen sessions.'
    )
    return {
      id: BaseExternalProvider.encodeId(this.id, String(entry.pid)),
      providerId: this.id,
      externalId: String(entry.pid),
      name: identity,
      state: 'detected',
      pid: entry.pid,
      cwd: entry.cwd,
      windows: null,
      attachedClients: null,
      createdAt: null,
      source: 'Linux /proc process scan',
      attachable: false,
      terminatable: false,
      detail: detailParts.join(' '),
      detectedAt: Date.now()
    }
  }
}
