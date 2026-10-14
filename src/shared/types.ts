/**
 * Shared domain types used across the main process, preload bridge and renderer.
 * This module must stay free of Node.js and Electron imports so it can be
 * bundled into the renderer safely.
 */

/** Lifecycle of a VoxTerm terminal session. */
export type ManagedSessionStatus = 'starting' | 'running' | 'exited'

/** A terminal session as surfaced to the UI. */
export interface TerminalSessionInfo {
  /** Stable identifier, independent of any visual tab position. */
  id: string
  title: string
  /** Absolute path to the executable backing the session. */
  shell: string
  shellName: string
  cwd: string
  pid: number | null
  cols: number
  rows: number
  status: ManagedSessionStatus
  exitCode: number | null
  exitSignal: number | null
  createdAt: number
  lastActiveAt: number
}

export interface CreateTerminalOptions {
  /** Override the detected shell executable. */
  shell?: string
  /** Extra arguments passed to the shell. */
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  title?: string
  env?: Record<string, string>
}

export type CloseSessionResult = {
  id: string
  /** Whether the underlying process was actually terminated. */
  terminated: boolean
  message?: string
}

/** Result of a terminal operation that can fail for user-facing reasons. */
export interface OperationResult {
  ok: boolean
  message?: string
  code?: string
}

// ---------------------------------------------------------------------------
// Agent profiles
// ---------------------------------------------------------------------------

export interface AgentCapabilities {
  /** Whether interactive prompt injection is safe/known for this agent. */
  promptInjection: boolean
  /** Whether structured event hooks are known to exist. */
  structuredEvents: boolean
}

export interface AgentProfile {
  id: string
  name: string
  /** Executable name or absolute path. Never a shell pipeline. */
  command: string
  args: string[]
  description?: string
  /** Name of an icon from the application icon set. */
  icon?: string
  /** Environment overrides applied only to this agent's session. */
  env?: Record<string, string>
  kind: 'builtin' | 'custom'
  capabilities: AgentCapabilities
}

export interface AgentProfileStatus extends AgentProfile {
  available: boolean
  resolvedPath: string | null
  version: string | null
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type ActivityCategory =
  | 'terminal'
  | 'settings'
  | 'agent'
  | 'voice'
  | 'system'
  | 'error'

export type ActivityLevel = 'info' | 'success' | 'warn' | 'error'

export interface ActivityEvent {
  id: string
  timestamp: number
  category: ActivityCategory
  type: string
  message: string
  level: ActivityLevel
  /**
   * When identical consecutive events are coalesced (e.g. slider changes), this
   * counts how many occurrences the row represents.
   */
  count?: number
  /** Small, non-sensitive metadata only. */
  details?: Record<string, string | number | boolean | null>
}

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

export interface ToolAvailability {
  name: string
  path: string | null
  available: boolean
  version: string | null
}

export interface SystemInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
  osRelease: string
  hostname: string
  /** Detected default shell. */
  defaultShell: string
  shells: ToolAvailability[]
  tmux: ToolAvailability
  screen: ToolAvailability
  /** Coding-agent executables discovered on PATH. */
  agents: ToolAvailability[]
  /** Whisper / transcription readiness. */
  whisper: {
    provider: 'none' | 'whisper-local'
    binaryPath: string | null
    modelPath: string | null
    modelPresent: boolean
    available: boolean
  }
  terminalBackend: {
    nodePty: boolean
    ptyVersion: string | null
    error?: string
  }
}
