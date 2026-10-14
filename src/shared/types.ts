/**
 * Shared domain types used across the main process, preload bridge and renderer.
 * This module must stay free of Node.js and Electron imports so it can be
 * bundled into the renderer safely.
 */

/** Lifecycle of a VoxTerm-managed pseudo-terminal session. */
export type ManagedSessionStatus = 'starting' | 'running' | 'exited'

/**
 * Lifecycle of a session that originates outside VoxTerm (for example a
 * `tmux` session, or a foreign terminal window). States are intentionally
 * explicit so the UI never claims a connection that does not exist.
 */
export type ExternalSessionState =
  | 'detected'
  | 'attachable'
  | 'connected'
  | 'detached'
  | 'exited'
  | 'unsupported'
  | 'attach_failed'

/** A managed terminal session as surfaced to the UI. */
export interface TerminalSessionInfo {
  /** Stable identifier, independent of any visual tab position. */
  id: string
  title: string
  /** How the session was created. */
  origin: 'managed' | 'external'
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
  /** Populated for `origin: 'external'`. */
  providerId?: string
  externalSessionId?: string
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

export type CloseSessionMode = 'detach' | 'terminate'

export interface CloseSessionResult {
  id: string
  mode: CloseSessionMode
  /** Whether the underlying process was actually terminated. */
  terminated: boolean
  /** True when the tab was removed but the process (external) kept running. */
  detached: boolean
  message?: string
}

/** Result of a terminal operation that can fail for user-facing reasons. */
export interface OperationResult {
  ok: boolean
  message?: string
  code?: string
}

// ---------------------------------------------------------------------------
// External session integration
// ---------------------------------------------------------------------------

export interface ExternalProviderCapabilities {
  discover: boolean
  inspect: boolean
  attach: boolean
  detach: boolean
  terminate: boolean
  getStatus: boolean
}

export interface ExternalProviderInfo {
  id: string
  name: string
  description: string
  /** True when the underlying tool (e.g. `tmux`) is actually present. */
  available: boolean
  /** Human readable explanation when `available` is false. */
  reason?: string
  capabilities: ExternalProviderCapabilities
}

export interface ExternalSessionInfo {
  /** Composite id: `${providerId}:${externalId}`. */
  id: string
  providerId: string
  /** Provider-scoped identifier (e.g. the tmux session name). */
  externalId: string
  name: string
  state: ExternalSessionState
  pid: number | null
  cwd: string | null
  windows: number | null
  attachedClients: number | null
  createdAt: number | null
  /** How this session was found, for transparency in the UI. */
  source: string
  attachable: boolean
  terminatable: boolean
  /** Managed session id when state is `connected`. */
  managedSessionId?: string
  /** Set when state is `attach_failed` or `unsupported`. */
  detail?: string
  detectedAt: number
}

export interface AttachExternalResult {
  ok: boolean
  state: ExternalSessionState
  managedSessionId?: string
  message?: string
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
  | 'external'
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
  externalDiscovery: {
    enabled: boolean
    providers: ExternalProviderInfo[]
  }
}
