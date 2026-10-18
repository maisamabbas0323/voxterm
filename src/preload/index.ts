import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type {
  AnnouncementAudioPayload,
  HotkeyPayload,
  MicrophoneAccessResult,
  StopRecordingPayload,
  VoxTermAPI
} from '@shared/api'
import type { SecretsStatus, Settings } from '@shared/schemas'
import type {
  ActivityEvent,
  AgentProfileStatus,
  AnnouncementStatus,
  CloseSessionResult,
  CreateTerminalOptions,
  DiagnosticsReport,
  ExternalDiscoveryResult,
  OperationResult,
  PromptEnhanceResult,
  PromptProviderId,
  PromptProviderStatus,
  SystemInfo,
  TerminalSessionInfo,
  TranscribeResult,
  VoiceStatus
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

/** Register an ipcRenderer listener and return an unsubscribe function. */
function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: VoxTermAPI = {
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    update: (patch) => invoke<Settings>(IPC.settingsUpdate, patch),
    reset: () => invoke<Settings>(IPC.settingsReset),
    setSecret: (slot, value) => invoke<OperationResult>(IPC.settingsSetSecret, { slot, value }),
    clearSecret: (slot) => invoke<OperationResult>(IPC.settingsClearSecret, { slot }),
    secretsStatus: () => invoke<SecretsStatus>(IPC.settingsSecretsStatus),
    onChanged: (listener) => on<Settings>(IPC_EVENTS.settingsChanged, listener)
  },
  system: {
    info: () => invoke<SystemInfo>(IPC.systemInfo),
    diagnostics: () => invoke<DiagnosticsReport>(IPC.systemDiagnostics),
    openExternal: (url) => invoke<OperationResult>(IPC.systemOpenExternal, url),
    showItemInFolder: (path) => invoke<OperationResult>(IPC.systemShowItemInFolder, path)
  },
  clipboard: {
    readText: () => invoke<string>(IPC.clipboardRead),
    writeText: (text) => invoke<void>(IPC.clipboardWrite, text)
  },
  window: {
    minimize: () => invoke<void>(IPC.windowMinimize),
    maximizeToggle: () => invoke<boolean>(IPC.windowMaximizeToggle),
    close: () => invoke<void>(IPC.windowClose),
    isMaximized: () => invoke<boolean>(IPC.windowIsMaximized),
    onMaximizedChanged: (listener) => on<boolean>(IPC_EVENTS.windowMaximizedChanged, listener)
  },
  terminals: {
    create: (options: CreateTerminalOptions = {}) =>
      invoke<TerminalSessionInfo>(IPC.terminalCreate, options),
    list: () => invoke<TerminalSessionInfo[]>(IPC.terminalList),
    subscribe: (sessionId) => invoke<string>(IPC.terminalSubscribe, sessionId),
    input: (sessionId, data) => invoke<OperationResult>(IPC.terminalInput, { sessionId, data }),
    resize: (sessionId, cols, rows) => invoke<OperationResult>(IPC.terminalResize, { sessionId, cols, rows }),
    rename: (sessionId, title) => invoke<OperationResult>(IPC.terminalRename, { sessionId, title }),
    close: (sessionId) => invoke<CloseSessionResult>(IPC.terminalClose, sessionId),
    snapshot: (sessionId) => invoke<string>(IPC.terminalSnapshot, sessionId),
    onData: (listener) => on(IPC_EVENTS.terminalData, listener),
    onExit: (listener) => on(IPC_EVENTS.terminalExit, listener),
    onTitle: (listener) => on(IPC_EVENTS.terminalTitle, listener),
    onSessionChanged: (listener) => on<TerminalSessionInfo>(IPC_EVENTS.terminalSessionChanged, listener),
    onListChanged: (listener) => on<TerminalSessionInfo[]>(IPC_EVENTS.terminalListChanged, listener)
  },
  agents: {
    list: () => invoke<AgentProfileStatus[]>(IPC.agentsList),
    save: (profile) => invoke<AgentProfileStatus[]>(IPC.agentsSave, profile),
    delete: (id) => invoke<AgentProfileStatus[]>(IPC.agentsDelete, { id })
  },
  voice: {
    status: () => invoke<VoiceStatus>(IPC.voiceStatus),
    requestMicrophoneAccess: (payload) =>
      invoke<MicrophoneAccessResult>(IPC.voiceRequestMicrophonePermission, payload ?? {}),
    startRecording: (payload) => invoke<OperationResult>(IPC.voiceStartRecording, payload ?? {}),
    stopRecording: (payload: StopRecordingPayload) =>
      invoke<TranscribeResult>(IPC.voiceStopRecording, {
        // Structured clone keeps ArrayBuffer across the bridge; the main-side
        // schema converts it to a Buffer before writing the temp file.
        wav: new Uint8Array(payload.wav),
        sampleRate: payload.sampleRate,
        durationMs: payload.durationMs
      }),
    cancelRecording: () => invoke<void>(IPC.voiceCancelRecording),
    onStatusChanged: (listener) => on<VoiceStatus>(IPC_EVENTS.voiceStatusChanged, listener),
    onHotkey: (listener) => on<HotkeyPayload>(IPC_EVENTS.voiceHotkeyPressed, listener)
  },
  prompts: {
    status: () => invoke<PromptProviderStatus[]>(IPC.promptsStatus),
    test: (id: PromptProviderId) => invoke<PromptProviderStatus>(IPC.promptsTest, { id }),
    enhance: (payload) => invoke<PromptEnhanceResult>(IPC.promptsEnhance, payload)
  },
  announcements: {
    status: () => invoke<AnnouncementStatus>(IPC.announcementsStatus),
    test: () => invoke<OperationResult>(IPC.announcementsTest),
    onAudio: (listener) => on<AnnouncementAudioPayload>(IPC_EVENTS.announcementsAudio, listener)
  },
  external: {
    discover: () => invoke<ExternalDiscoveryResult>(IPC.externalDiscover)
  },
  activity: {
    list: () => invoke<ActivityEvent[]>(IPC.activityList),
    clear: () => invoke<OperationResult>(IPC.activityClear),
    onEvent: (listener) => on<ActivityEvent>(IPC_EVENTS.activityEvent, listener)
  },
  app: {
    onCloseRequested: (listener) => on(IPC_EVENTS.appCloseRequested, listener),
    respondClose: (payload) => invoke<void>(IPC.appRespondClose, payload),
    confirmQuit: () => invoke<void>(IPC.appConfirmQuit)
  }
}

contextBridge.exposeInMainWorld('voxterm', api)
