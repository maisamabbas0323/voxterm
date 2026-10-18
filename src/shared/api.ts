import type {
  ActivityEvent,
  AgentProfile,
  AgentProfileStatus,
  AnnouncementStatus,
  CloseSessionResult,
  CreateTerminalOptions,
  DiagnosticsReport,
  ExternalDiscoveryResult,
  MicrophonePermission,
  OperationResult,
  PromptEnhanceResult,
  PromptProviderId,
  PromptProviderStatus,
  SystemInfo,
  TerminalSessionInfo,
  TranscribeResult,
  VoiceStatus
} from './types'
import type { SecretsStatus, Settings } from './schemas'

export interface TerminalDataPayload {
  sessionId: string
  data: string
}

export interface TerminalExitPayload {
  sessionId: string
  exitCode: number | null
  signal: number | null
}

export interface TerminalTitlePayload {
  sessionId: string
  title: string
}

export interface AppCloseRequestPayload {
  runningSessions: number
  totalSessions: number
}

export interface AgentSavePayload {
  id?: string
  name: string
  command: string
  args?: string[]
  description?: string
  icon?: string
  env?: Record<string, string>
}

/** Renderer -> main: ask whether capture is permitted for the current settings. */
export interface MicrophoneAccessResult {
  allowed: boolean
  permission: MicrophonePermission
  message?: string
}

/** Renderer -> main: the finished 16-bit PCM WAV plus capture metadata. */
export interface StopRecordingPayload {
  /** Raw WAV bytes (ArrayBuffer survives structured clone; Buffer does not). */
  wav: ArrayBuffer
  sampleRate: number
  durationMs: number
}

/** Main -> renderer: encoded speech ready for local playback. */
export interface AnnouncementAudioPayload {
  id: string
  category: string
  mimeType: string
  dataBase64: string
}

/** Main -> renderer: the global push-to-talk hotkey changed state. */
export interface HotkeyPayload {
  pressed: boolean
}

/**
 * The narrow, typed surface exposed to the renderer through `contextBridge`.
 * No Node.js primitives, no unrestricted ipcRenderer, no child_process.
 */
export interface VoxTermAPI {
  settings: {
    get(): Promise<Settings>
    update(patch: unknown): Promise<Settings>
    reset(): Promise<Settings>
    setSecret(slot: string, value: string): Promise<OperationResult>
    clearSecret(slot: string): Promise<OperationResult>
    secretsStatus(): Promise<SecretsStatus>
    onChanged(listener: (settings: Settings) => void): () => void
  }
  system: {
    info(): Promise<SystemInfo>
    diagnostics(): Promise<DiagnosticsReport>
    openExternal(url: string): Promise<OperationResult>
    showItemInFolder(path: string): Promise<OperationResult>
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  window: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void
  }
  terminals: {
    create(options?: CreateTerminalOptions): Promise<TerminalSessionInfo>
    list(): Promise<TerminalSessionInfo[]>
    subscribe(sessionId: string): Promise<string>
    input(sessionId: string, data: string): Promise<OperationResult>
    resize(sessionId: string, cols: number, rows: number): Promise<OperationResult>
    rename(sessionId: string, title: string): Promise<OperationResult>
    close(sessionId: string): Promise<CloseSessionResult>
    snapshot(sessionId: string): Promise<string>
    onData(listener: (payload: TerminalDataPayload) => void): () => void
    onExit(listener: (payload: TerminalExitPayload) => void): () => void
    onTitle(listener: (payload: TerminalTitlePayload) => void): () => void
    onSessionChanged(listener: (session: TerminalSessionInfo) => void): () => void
    onListChanged(listener: (sessions: TerminalSessionInfo[]) => void): () => void
  }
  agents: {
    list(): Promise<AgentProfileStatus[]>
    save(profile: AgentSavePayload): Promise<AgentProfileStatus[]>
    delete(id: string): Promise<AgentProfileStatus[]>
  }
  voice: {
    status(): Promise<VoiceStatus>
    /**
     * Ask the main process whether microphone capture is permitted right now,
     * optionally recording the outcome `getUserMedia` actually reported.
     */
    requestMicrophoneAccess(payload?: { outcome?: 'granted' | 'denied' }): Promise<MicrophoneAccessResult>
    startRecording(payload?: { source?: 'manual' | 'hotkey' }): Promise<OperationResult>
    stopRecording(payload: StopRecordingPayload): Promise<TranscribeResult>
    cancelRecording(): Promise<void>
    onStatusChanged(listener: (status: VoiceStatus) => void): () => void
    onHotkey(listener: (payload: HotkeyPayload) => void): () => void
  }
  prompts: {
    status(): Promise<PromptProviderStatus[]>
    test(id: PromptProviderId): Promise<PromptProviderStatus>
    enhance(payload: { text: string; cwd?: string }): Promise<PromptEnhanceResult>
  }
  announcements: {
    status(): Promise<AnnouncementStatus>
    /** Make a real synthesis request and play the result locally. */
    test(): Promise<OperationResult>
    onAudio(listener: (payload: AnnouncementAudioPayload) => void): () => void
  }
  external: {
    discover(): Promise<ExternalDiscoveryResult>
  }
  activity: {
    list(): Promise<ActivityEvent[]>
    clear(): Promise<OperationResult>
    onEvent(listener: (event: ActivityEvent) => void): () => void
  }
  app: {
    onCloseRequested(listener: (payload: AppCloseRequestPayload) => void): () => void
    respondClose(payload: { confirm: boolean }): Promise<void>
    confirmQuit(): Promise<void>
  }
}

/** Convenience alias used by renderer components. */
export type { AgentProfile }
