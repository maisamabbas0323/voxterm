/**
 * Shared domain types used across the main process, preload bridge and renderer.
 * This module must stay free of Node.js and Electron imports so it can be
 * bundled into the renderer safely.
 */

/** Lifecycle of a VoxTerm terminal session. */
export type ManagedSessionStatus = 'starting' | 'running' | 'exited'

/**
 * Where a session came from. `managed` shells are owned outright by VoxTerm;
 * `tmux`/`screen` sessions belong to the multiplexer, so closing the tab only
 * detaches our client and never terminates the user's shared process.
 */
export interface SessionOrigin {
  kind: 'managed' | 'tmux' | 'screen'
  /** Multiplexer session name for attached sessions. */
  target?: string
  /** True when closing the tab detaches instead of terminating. */
  detachOnly: boolean
}

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
  origin: SessionOrigin
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
  /**
   * Attach to an existing multiplexer session. The command is built in the main
   * process from validated fields — the renderer can never inject arbitrary
   * executable arguments.
   *
   * `target` is the multiplexer's exact identifier (a tmux `$N` session id, or
   * `pid.name` for screen) when discovery reported one; tmux parses `-t` as
   * `session:window.pane`, so a plain name silently fails for names containing
   * `.` or `:` while the id always resolves. `busy` means another client already
   * has the session open: screen then needs shared join mode (`-x`) instead of
   * `-r`, and neither multiplexer is ever told to kick that client.
   */
  attach?: { kind: 'tmux' | 'screen'; name: string; target?: string | null; busy?: boolean }
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
  /** Speech-to-text readiness. */
  stt: SttRuntimeInfo
  terminalBackend: {
    nodePty: boolean
    ptyVersion: string | null
    error?: string
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown'
export type VoiceHotkeyMode = 'unavailable' | 'toggle' | 'hold'
export type VoiceRecordingMode = 'idle' | 'recording' | 'transcribing'

/** Readiness of the ElevenLabs speech-to-text provider. */
export interface SttRuntimeInfo {
  provider: 'elevenlabs'
  /** An API key is present, so a recording can be sent for transcription. */
  configured: boolean
  modelId: string
  /** Human-readable explanation shown in Settings and diagnostics. */
  detail: string
}

export interface VoiceStatus {
  enabled: boolean
  recordingMode: VoiceRecordingMode
  hotkey: {
    registered: boolean
    mode: VoiceHotkeyMode
    shortcut: string
    /** Honest explanation when the hotkey could not be registered. */
    error: string | null
  }
  microphonePermission: MicrophonePermission
  stt: SttRuntimeInfo
}

export type TranscribeErrorCode =
  | 'disabled'
  | 'not-configured'
  | 'invalid-audio'
  | 'too-short'
  | 'empty'
  | 'timeout'
  | 'failed'
  | 'busy'

export interface TranscribeResult {
  ok: boolean
  /** Transcribed text; empty when ok is false. */
  text: string
  /** Detected or configured language code. */
  language: string | null
  /** Average token probability (0..1) when the runtime reports it. */
  confidence: number | null
  /** Duration of the captured audio in milliseconds. */
  audioMs: number
  /** Wall-clock transcription time in milliseconds. */
  inferenceMs: number
  error?: string
  code?: TranscribeErrorCode
}

// ---------------------------------------------------------------------------
// Prompt enhancement (Gemma providers)
// ---------------------------------------------------------------------------

export type PromptProviderId = 'ollama' | 'google'

export interface PromptProviderStatus {
  id: PromptProviderId
  enabled: boolean
  /** False when the current privacy mode forbids this provider (cloud in local-only). */
  allowed: boolean
  /** Credentials + endpoint + model are all present. */
  configured: boolean
  reachable: boolean
  /** Model that would be used: the configured value or an auto-detected one. */
  model: string | null
  message: string
  ms: number | null
}

export interface PromptAttempt {
  id: PromptProviderId
  ok: boolean
  message: string
}

export interface PromptEnhanceResult {
  ok: boolean
  provider: PromptProviderId | null
  original: string
  enhanced: string
  usedProjectContext: boolean
  attempts: PromptAttempt[]
  ms: number
  error?: string
  /** True when enhancement was refused because no cloud/local provider was allowed. */
  blocked?: boolean
}

// ---------------------------------------------------------------------------
// Announcements (text-to-speech)
// ---------------------------------------------------------------------------

export interface AnnouncementStatus {
  enabled: boolean
  muted: boolean
  /** API key and voice id are both present. */
  configured: boolean
  voiceId: string | null
  modelId: string
  playing: boolean
  queued: number
  lastError: string | null
}

// ---------------------------------------------------------------------------
// External multiplexer sessions
// ---------------------------------------------------------------------------

export type ExternalSessionKind = 'tmux' | 'screen'

export interface ExternalSession {
  /** Stable id: `${kind}:${name}`. */
  id: string
  kind: ExternalSessionKind
  name: string
  /**
   * Exact identifier for the multiplexer's attach target when reporting it:
   * tmux's `$N` session id, or screen's `pid.name` socket. Null when only the
   * display name is known. Names containing `.`/`:` cannot be targeted in tmux
   * by name at all, so this is what makes those sessions attachable.
   */
  target: string | null
  windows: number | null
  /** Clients currently attached, when the multiplexer reports it. */
  attachedClients: number | null
  /** At least one other client already has this session open. */
  busy: boolean
  /** Epoch ms of the session creation time, when reported. */
  createdAt: number | null
  attachable: boolean
  /** Present when the session is not attachable or a caveat applies. */
  reason?: string
}

export interface ExternalDiscovery {
  kind: ExternalSessionKind
  /** Whether the multiplexer binary itself was found on PATH. */
  available: boolean
  message: string
  sessions: ExternalSession[]
}

export interface ExternalDiscoveryResult {
  checkedAt: number
  results: ExternalDiscovery[]
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Non-secret snapshot the user can copy when reporting a problem. */
export interface DiagnosticsReport {
  generatedAt: number
  appVersion: string
  platform: string
  arch: string
  electron: string
  node: string
  paths: Record<string, string>
  terminalBackend: { nodePty: boolean; ptyVersion: string | null; error?: string }
  voice: VoiceStatus
  providers: PromptProviderStatus[]
  announcements: AnnouncementStatus
  settingsIssues: string[]
}
