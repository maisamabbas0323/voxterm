import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const isDev = !!process.env.ELECTRON_RENDERER_URL

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
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#08080a',
    title: 'VoxTerm',
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
