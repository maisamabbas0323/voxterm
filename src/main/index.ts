import { app, BrowserWindow, session as electronSession } from 'electron'
import { join } from 'node:path'
import { IPC_EVENTS } from '@shared/ipc'
import type { ExternalSessionInfo } from '@shared/types'
import { SettingsStore } from './settings/store'
import { ActivityLog } from './activity/log'
import { TerminalSessionManager } from './terminals/SessionManager'
import { AgentProfileStore } from './agents/store'
import { ExternalSessionRegistry } from './external/registry'
import { TmuxExternalProvider } from './external/providers/tmux'
import { ScreenExternalProvider } from './external/providers/screen'
import { DesktopTerminalsExternalProvider } from './external/providers/desktopTerminals'
import type { ProviderContext } from './external/provider'
import { Logger } from './util/logger'
import { execFileSafe, resetUserPathCache, resolveUserPath } from './util/exec'
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

const knownExternalIds = new Set<string>()

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
  services.external.stop()
  disposeEvents?.()
  disposeEvents = null

  const policy = services.settings.get().privacy.sessionCleanupOnExit
  const sessions = services.sessions.list()
  if (policy === 'keep-managed') {
    // Best effort: detach external clients so multiplexer sessions persist,
    // and leave managed shells untouched.
    for (const item of sessions) {
      if (item.origin === 'external') {
        await services.sessions.terminate(item.id, 'SIGHUP').catch(() => undefined)
      }
    }
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

  const providerContext: ProviderContext = {
    execFileSafe,
    logger,
    resolvePath: resolveUserPath,
    sessions,
    getSettings: () => settings.get()
  }

  const external = new ExternalSessionRegistry(
    [new TmuxExternalProvider(), new ScreenExternalProvider(), new DesktopTerminalsExternalProvider()],
    {
      context: providerContext,
      getSettings: () => settings.get(),
      onSessionsChanged: (list) => {
        broadcast(IPC_EVENTS.externalChanged, list)
        recordNewlyDiscovered(activity, list)
      },
      onProviderError: (providerId, message) => {
        logger.warn('external', `Provider "${providerId}" error: ${message}`)
        activity.record({
          category: 'error',
          type: 'external.provider-error',
          message: `External provider "${providerId}" failed: ${message}`,
          level: 'error',
          details: { providerId }
        })
      }
    }
  )

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
    external,
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
    external.configure()
  })

  external.start()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function recordNewlyDiscovered(activity: ActivityLog, list: ExternalSessionInfo[]): void {
  const current = new Set(list.map((item) => item.id))
  for (const item of list) {
    if (!knownExternalIds.has(item.id)) {
      knownExternalIds.add(item.id)
      activity.record({
        category: 'external',
        type: 'external.discovered',
        message: `Discovered external session "${item.name}" (${item.providerId})`,
        level: 'info',
        details: { sessionId: item.id, providerId: item.providerId, state: item.state }
      })
    }
  }
  for (const id of [...knownExternalIds]) {
    if (!current.has(id)) knownExternalIds.delete(id)
  }
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
