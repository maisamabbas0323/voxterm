import { app, BrowserWindow, globalShortcut, session as electronSession, systemPreferences } from 'electron'
import { join } from 'node:path'
import { IPC_EVENTS } from '@shared/ipc'
import { SettingsStore } from './settings/store'
import { loadEnvFile } from './settings/loadEnv'
import { ActivityLog } from './activity/log'
import { TerminalSessionManager } from './terminals/SessionManager'
import { AgentProfileStore } from './agents/store'
import { VoiceController } from './voice/VoiceController'
import { AnnouncementService } from './announcements/service'
import { PromptService } from './prompts/service'
import { discoverExternalSessions } from './external/discover'
import { Logger } from './util/logger'
import { resetUserPathCache, resolveUserPath } from './util/exec'
import { createMainWindow, currentCsp } from './window'
import { registerIpcHandlers, wireMainEvents } from './ipc'
import { broadcast, type Services } from './services'

// Load credentials and runtime knobs from a local .env before anything reads
// them. Both the working directory and the app directory are tried so the same
// file works in development, from a source checkout, and in a packaged build.
// A variable already set in the real environment is never overwritten, so an
// exported value always wins over the file.
for (const candidate of [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')]) {
  loadEnvFile(candidate)
}

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

  services.voice.dispose()
  services.announcements.dispose()

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
}

/**
 * Microphone, and only microphone.
 *
 * VoxTerm loads a single local renderer, so device permissions are granted only
 * for the main window's web contents, only while the user has voice input
 * enabled, and only for audio (never camera). Everything else is denied.
 */
function configurePermissions(getServices: () => Services | null, isTrustedContents: (wc: unknown) => boolean): void {
  const session = electronSession.defaultSession

  const permitted = (permission: string, mediaTypes?: string[]): boolean => {
    if (permission !== 'media') return false
    const services = getServices()
    if (services?.settings.get().voice.enabled !== true) return false
    if (mediaTypes && mediaTypes.length > 0 && !mediaTypes.every((type) => type === 'audio')) return false
    return true
  }

  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes
    callback(permitted(permission, mediaTypes) && isTrustedContents(wc))
  })

  session.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes
    // Chromium may ask with no webContents; the app is the only renderer, so the
    // settings gate above is what actually protects the microphone.
    if (wc && !isTrustedContents(wc)) return false
    return permitted(permission, mediaTypes)
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

  const voice = new VoiceController({
    settings,
    logger,
    activity,
    getSecret: (slot) => settings.getSecret(slot),
    broadcast,
    globalShortcut: { register: globalShortcut.register, unregister: globalShortcut.unregister },
    getMediaAccessStatus: (mediaType) => systemPreferences.getMediaAccessStatus(mediaType),
    requestOsAccess: async () => {
      if (process.platform !== 'darwin') return null
      try {
        return await systemPreferences.askForMediaAccess('microphone')
      } catch {
        return null
      }
    }
  })

  const announcements = new AnnouncementService({
    getSettings: () => settings.get(),
    getSecret: (slot) => settings.getSecret(slot),
    logger,
    record: (event) => {
      activity.record(event)
    },
    // Audio is synthesized in main (the production CSP forbids renderer network
    // access); the renderer only ever receives base64 bytes to play.
    deliver: (payload) => broadcast(IPC_EVENTS.announcementsAudio, payload)
  })

  const external = {
    discover: () =>
      discoverExternalSessions({
        getSettings: () => settings.get(),
        resolvePath: resolveUserPath,
        logger
      })
  }

  const prompts = new PromptService({
    getSettings: () => settings.get(),
    // Secrets are read through the store on every call so a key stored (or
    // cleared) after launch takes effect without a restart.
    getSecret: (slot) => settings.getSecret(slot),
    logger
  })

  services = {
    settings,
    activity,
    sessions,
    agents,
    voice,
    announcements,
    external,
    prompts,
    logger,
    resolvePath: resolveUserPath,
    getWindow,
    requestAppClose,
    respondToClose
  }

  registerIpcHandlers(services)
  disposeEvents = wireMainEvents(services)
  configureCsp()
  configurePermissions(
    () => services,
    (wc) => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents === wc)
  )
  void voice.bootstrap()

  settings.onChange((next) => {
    logger.configure({ enabled: next.privacy.diagnosticLogging, redact: next.privacy.redactLogs })
    activity.setRetention(next.privacy.activityRetention)
    resetUserPathCache()
    services?.voice.applySettings()
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
