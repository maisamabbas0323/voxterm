import { app, BrowserWindow, session as electronSession } from 'electron'
import { join } from 'node:path'
import { IPC_EVENTS } from '@shared/ipc'
import { SettingsStore } from './settings/store'
import { ActivityLog } from './activity/log'
import { TerminalSessionManager } from './terminals/SessionManager'
import { AgentProfileStore } from './agents/store'
import { Logger } from './util/logger'
import { resetUserPathCache, resolveUserPath } from './util/exec'
import { createMainWindow, currentCsp } from './window'
import { registerIpcHandlers, wireMainEvents } from './ipc'
import { broadcast, type Services } from './services'

// Renderer sandbox hardening is requested via webPreferences; the Chromium
// SUID sandbox can still be disabled explicitly for constrained environments.
if (process.env.VOXTERM_DISABLE_CHROMIUM_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let disposeEvents: (() => void) | null = null
let shuttingDown = false
let cleanedUp = false
let closeResponded = false
let closePromptVisible = false

function countRunningSessions(): number {
  return services ? services.sessions.list().filter((item) => item.status === 'running').length : 0
}

/** Begin the graceful-close flow, prompting only when it is warranted. */
function requestAppClose(): void {
  if (!services || !mainWindow) return
  const running = countRunningSessions()
  const confirm = services.settings.get().terminal.confirmBeforeAppClose
  if (running === 0 || !confirm) {
    closeResponded = true
    mainWindow.close()
    return
  }
  if (closePromptVisible) return
  closePromptVisible = true
  broadcast(IPC_EVENTS.appCloseRequested, {
    runningSessions: running,
    totalSessions: services.sessions.list().length
  })
}

function respondToClose(confirm: boolean): void {
  closePromptVisible = false
  if (!confirm || !mainWindow) return
  closeResponded = true
  mainWindow.close()
}

async function shutdown(): Promise<void> {
  if (!services) return
  disposeEvents?.()
  disposeEvents = null

  const policy = services.settings.get().privacy.sessionCleanupOnExit
  if (policy === 'keep-managed') {
    // The user explicitly asked to keep shells running after VoxTerm exits, so
    // drop our references without signalling the processes.
    services.sessions.releaseAll()
  } else {
    await services.sessions.terminateAll('SIGHUP').catch(() => undefined)
  }

  services.activity.flush()
}

function configureCsp(): void {
  const csp = currentCsp()
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  // VoxTerm needs no renderer-side device permissions; deny them all.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}

function bootstrap(): void {
  const userData = app.getPath('userData')
  const logger = new Logger({
    directory: join(userData, 'logs'),
    enabled: false,
    redact: true
  })

  const settings = new SettingsStore(logger)
  settings.load()
  logger.configure({
    enabled: settings.get().privacy.diagnosticLogging,
    redact: settings.get().privacy.redactLogs
  })

  const activity = new ActivityLog(logger)
  activity.load()
  activity.setRetention(settings.get().privacy.activityRetention)
  activity.record({
    category: 'system',
    type: 'app.started',
    message: `VoxTerm ${app.getVersion()} started`,
    level: 'success',
    details: { electron: process.versions.electron ?? 'unknown', platform: process.platform }
  })

  const sessions = new TerminalSessionManager({
    logger,
    getSettings: () => settings.get(),
    resolvePath: resolveUserPath
  })

  const agents = new AgentProfileStore(logger)
  agents.load()

  mainWindow = createMainWindow({
    onMaximizedChanged: (maximized) => broadcast(IPC_EVENTS.windowMaximizedChanged, maximized),
    onCloseRequested: (event) => {
      if (closeResponded || cleanedUp) return
      const running = countRunningSessions()
      const confirm = settings.get().terminal.confirmBeforeAppClose
      if (running > 0 && confirm) {
        event.preventDefault()
        requestAppClose()
      } else {
        closeResponded = true
      }
    }
  })

  const getWindow = (): BrowserWindow | null => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

  services = {
    settings,
    activity,
    sessions,
    agents,
    logger,
    resolvePath: resolveUserPath,
    getWindow,
    requestAppClose,
    respondToClose
  }

  registerIpcHandlers(services)
  disposeEvents = wireMainEvents(services)
  configureCsp()

  settings.onChange((next) => {
    logger.configure({ enabled: next.privacy.diagnosticLogging, redact: next.privacy.redactLogs })
    activity.setRetention(next.privacy.activityRetention)
    resetUserPathCache()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    bootstrap()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        bootstrap()
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void shutdown()
      .catch(() => undefined)
      .finally(() => {
        cleanedUp = true
        app.quit()
      })
  })
}
