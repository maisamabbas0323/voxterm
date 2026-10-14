import type {
  ActivityEvent,
  AgentProfile,
  AgentProfileStatus,
  AttachExternalResult,
  CloseSessionMode,
  CloseSessionResult,
  CreateTerminalOptions,
  ExternalProviderInfo,
  ExternalSessionInfo,
  OperationResult,
  SystemInfo,
  TerminalSessionInfo
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

export interface ExternalStatusResult {
  id: string
  state: ExternalSessionInfo['state']
  managedSessionId?: string
  detail?: string
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
    close(sessionId: string, mode: CloseSessionMode): Promise<CloseSessionResult>
    terminate(sessionId: string): Promise<CloseSessionResult>
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
  external: {
    listProviders(): Promise<ExternalProviderInfo[]>
    list(): Promise<ExternalSessionInfo[]>
    refresh(): Promise<ExternalSessionInfo[]>
    attach(id: string): Promise<AttachExternalResult>
    detach(id: string): Promise<OperationResult>
    terminate(id: string): Promise<OperationResult>
    status(id: string): Promise<ExternalStatusResult>
    onChanged(listener: (sessions: ExternalSessionInfo[]) => void): () => void
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
