import { BrowserWindow } from 'electron'
import type { SettingsStore } from './settings/store'
import type { ActivityLog } from './activity/log'
import type { TerminalSessionManager } from './terminals/SessionManager'
import type { AgentProfileStore } from './agents/store'
import type { Logger } from './util/logger'

/** Dependency container shared by every IPC handler registration. */
export interface Services {
  settings: SettingsStore
  activity: ActivityLog
  sessions: TerminalSessionManager
  agents: AgentProfileStore
  logger: Logger
  resolvePath: () => Promise<string>
  getWindow: () => BrowserWindow | null
  /** Begin the graceful application close flow. */
  requestAppClose: () => void
  /** Renderer's answer to the "sessions are running" close prompt. */
  respondToClose: (confirm: boolean) => void
}

/** Send an event to every live renderer. */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}
