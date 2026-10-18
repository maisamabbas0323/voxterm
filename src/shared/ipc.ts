/**
 * Canonical IPC channel names. Kept in shared code so main, preload and the
 * renderer can never drift out of sync. Channels are split into request
 * (renderer -> main, invoke/handle) and event (main -> renderer, send).
 */

export const IPC = {
  // Settings
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsSetSecret: 'settings:set-secret',
  settingsClearSecret: 'settings:clear-secret',
  settingsSecretsStatus: 'settings:secrets-status',

  // System
  systemInfo: 'system:info',
  systemOpenExternal: 'system:open-external',
  systemShowItemInFolder: 'system:show-item-in-folder',

  // Clipboard (routed through main so the sandboxed renderer needs no access)
  clipboardRead: 'clipboard:read-text',
  clipboardWrite: 'clipboard:write-text',

  // Window controls
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // Terminals
  terminalCreate: 'terminal:create',
  terminalList: 'terminal:list',
  terminalSubscribe: 'terminal:subscribe',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalRename: 'terminal:rename',
  terminalClose: 'terminal:close',
  terminalSnapshot: 'terminal:snapshot',

  // Agents
  agentsList: 'agents:list',
  agentsSave: 'agents:save',
  agentsDelete: 'agents:delete',

  // Voice
  voiceStatus: 'voice:status',
  voiceStartRecording: 'voice:start-recording',
  voiceStopRecording: 'voice:stop-recording',
  voiceCancelRecording: 'voice:cancel-recording',
  voiceRequestMicrophonePermission: 'voice:request-microphone-permission',

  // Prompt enhancement
  promptsStatus: 'prompts:status',
  promptsTest: 'prompts:test',
  promptsEnhance: 'prompts:enhance',

  // Announcements (text-to-speech)
  announcementsStatus: 'announcements:status',
  announcementsTest: 'announcements:test',

  // External multiplexer sessions
  externalDiscover: 'external:discover',

  // Diagnostics
  systemDiagnostics: 'system:diagnostics',

  // Activity
  activityList: 'activity:list',
  activityClear: 'activity:clear',

  // Application lifecycle
  appRespondClose: 'app:respond-close',
  appConfirmQuit: 'app:confirm-quit'
} as const

export const IPC_EVENTS = {
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  terminalTitle: 'terminal:title',
  terminalSessionChanged: 'terminal:session-changed',
  terminalListChanged: 'terminal:list-changed',
  activityEvent: 'activity:event',
  settingsChanged: 'settings:changed',
  windowMaximizedChanged: 'window:maximized-changed',
  appCloseRequested: 'app:close-requested',
  systemInfoChanged: 'system:info-changed',
  voiceStatusChanged: 'voice:status-changed',
  voiceHotkeyPressed: 'voice:hotkey-pressed',
  announcementsAudio: 'announcements:audio'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
