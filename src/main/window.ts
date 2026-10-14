import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const isDev = !!process.env.ELECTRON_RENDERER_URL

/**
 * Resolve the packaged app icon. In development the repository layout keeps it
 * at <root>/resources; in a packaged build app.getAppPath() points at the app
 * root (asar paths transparently resolve into app.asar.unpad for unpacked
 * files). Returns null when missing so Electron falls back gracefully.
 */
function resolveAppIcon(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.resourcesPath ?? '', 'icon.png')
  ]
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      /* keep looking */
    }
  }
  return null
}

export interface WindowCallbacks {
  onMaximizedChanged?: (maximized: boolean) => void
  /** Return false to veto the close (e.g. running sessions need confirmation). */
  onCloseRequested?: (event: Electron.Event) => void
}

/**
 * Create the single main application window.
 *
 * Security posture: context isolation on, node integration off, renderer
 * sandboxed, and the preload exposes only a narrow typed bridge. The window
 * uses a frameless custom title bar, so window controls are re-implemented
 * through IPC.
 */
export function createMainWindow(callbacks: WindowCallbacks = {}): BrowserWindow {
  const icon = resolveAppIcon()
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#08080a',
    title: 'VoxTerm',
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: true
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // Zoom is a *terminal* concern in VoxTerm, never a page concern. Pinch and
  // Ctrl+wheel must not scale the whole interface, so visual zoom is disabled
  // and any requested page zoom is immediately reset. The renderer applies
  // zoom to the terminal font instead.
  window.webContents.setVisualZoomLevelLimits(1, 1)
  window.webContents.on('zoom-changed', (event) => {
    event.preventDefault()
    window.webContents.setZoomFactor(1)
  })
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(1)
  })

  window.on('maximize', () => callbacks.onMaximizedChanged?.(true))
  window.on('unmaximize', () => callbacks.onMaximizedChanged?.(false))

  window.on('close', (event) => {
    callbacks.onCloseRequested?.(event)
  })

  // Never allow the renderer to navigate away from the app or spawn windows.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/** Content Security Policy for the packaged renderer. */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Content Security Policy for the Vite dev server (adds HMR websocket access). */
export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

export function currentCsp(): string {
  return isDev ? DEVELOPMENT_CSP : PRODUCTION_CSP
}
