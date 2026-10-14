import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Settings } from '@shared/schemas'

/** xterm colour theme derived from the VoxTerm design tokens. */
const THEME: ITheme = {
  background: '#070709',
  foreground: '#ecedf3',
  cursor: '#6c8cff',
  cursorAccent: '#070709',
  selectionBackground: 'rgba(108, 140, 255, 0.28)',
  black: '#15151a',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#6c8cff',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c0caf5',
  brightBlack: '#4c4c56',
  brightRed: '#ff8fa3',
  brightGreen: '#b9f27c',
  brightYellow: '#f5c884',
  brightBlue: '#93b4f9',
  brightMagenta: '#d0b0ff',
  brightCyan: '#a4e1ff',
  brightWhite: '#ffffff'
}

const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 48
const DEFAULT_FONT_SIZE = 13
const ZOOM_MIN = -24
const ZOOM_MAX = 24

/**
 * Terminal zoom is applied to the font size only, so zooming never changes the
 * surrounding interface. The configured preference is the base; the transient
 * zoom step is layered on top and clamped to a readable range.
 */
function resolveFontSize(base: number, zoom: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(base + zoom)))
}

/**
 * Owns a single xterm.js instance for a session. xterm instances are cached by
 * session id and survive React remounts (e.g. StrictMode) so scrollback is
 * never lost — only explicit disposal releases them.
 */
export class TerminalController {
  readonly term: Terminal
  private readonly fit: FitAddon
  private readonly search: SearchAddon
  private element: HTMLElement | null = null
  private hydrating = true
  private queue: string[] = []
  private disposers: IDisposable[] = []

  constructor(
    readonly sessionId: string,
    settings: Settings,
    zoom = 0
  ) {
    const appearance = settings.appearance
    this.term = new Terminal({
      fontFamily: appearance.terminalFontFamily,
      fontSize: resolveFontSize(appearance.terminalFontSize, zoom),
      lineHeight: appearance.terminalLineHeight,
      cursorStyle: appearance.cursorStyle,
      cursorBlink: appearance.cursorBlink,
      scrollback: settings.terminal.scrollback,
      theme: THEME,
      allowProposedApi: true,
      convertEol: false,
      macOptionIsMeta: false,
      scrollOnUserInput: true,
      smoothScrollDuration: settings.appearance.reducedMotion ? 0 : 90
    })

    this.fit = new FitAddon()
    this.search = new SearchAddon()
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        if (uri.startsWith('https://') || uri.startsWith('http://')) {
          void window.voxterm.system.openExternal(uri)
        }
      })
    )

    this.disposers.push(
      this.term.onData((data) => {
        void window.voxterm.terminals.input(this.sessionId, data)
      }),
      this.term.onResize(({ cols, rows }) => {
        void window.voxterm.terminals.resize(this.sessionId, cols, rows)
      })
    )

    this.term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const ctrlShift = event.ctrlKey && event.shiftKey
      if (ctrlShift && event.code === 'KeyC') {
        const selection = this.term.getSelection()
        if (selection) void window.voxterm.clipboard.writeText(selection)
        event.preventDefault()
        return false
      }
      if (ctrlShift && event.code === 'KeyA') {
        this.term.selectAll()
        event.preventDefault()
        return false
      }
      return true
    })
  }

  /** Attach the terminal to a container element (safe to call repeatedly). */
  attach(container: HTMLElement): void {
    if (!this.element) {
      this.term.open(container)
      this.element = this.term.element ?? null
    } else if (this.element.parentElement !== container) {
      container.appendChild(this.element)
    }
    this.fitNow()
  }

  /** Feed any output buffered before the renderer attached. */
  hydrate(buffer: string): void {
    if (buffer) this.term.write(buffer)
    this.hydrating = false
    const pending = this.queue
    this.queue = []
    for (const chunk of pending) this.term.write(chunk)
  }

  write(data: string): void {
    if (this.hydrating) {
      this.queue.push(data)
      return
    }
    this.term.write(data)
  }

  handleExit(exitCode: number | null, signal: number | null): void {
    const detail =
      exitCode === null
        ? 'process exited'
        : `process exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}`
    this.term.write(`\r\n\x1b[2;90m[${detail}]\x1b[0m\r\n`)
  }

  focus(): void {
    this.term.focus()
  }

  fitNow(): void {
    try {
      this.fit.fit()
    } catch {
      /* container may be hidden or zero-sized */
    }
  }

  setAppearance(settings: Settings, zoom: number): void {
    const appearance = settings.appearance
    this.term.options.fontFamily = appearance.terminalFontFamily
    this.term.options.fontSize = resolveFontSize(appearance.terminalFontSize, zoom)
    this.term.options.lineHeight = appearance.terminalLineHeight
    this.term.options.cursorStyle = appearance.cursorStyle
    this.term.options.cursorBlink = appearance.cursorBlink
    this.term.options.smoothScrollDuration = appearance.reducedMotion ? 0 : 90
    this.fitNow()
  }

  clear(): void {
    this.term.clear()
  }

  selectAll(): void {
    this.term.selectAll()
  }

  getSelection(): string {
    return this.term.getSelection()
  }

  findNext(query: string): boolean {
    return this.search.findNext(query, { caseSensitive: false })
  }

  findPrevious(query: string): boolean {
    return this.search.findPrevious(query, { caseSensitive: false })
  }

  clearSearch(): void {
    this.search.clearDecorations()
  }

  dispose(): void {
    for (const item of this.disposers) item.dispose()
    this.disposers = []
    try {
      this.term.dispose()
    } catch {
      /* ignore */
    }
    this.element = null
  }
}

/**
 * Routes streamed PTY output from the main process to the correct xterm
 * instance. A single subscription is installed for the whole application.
 */
class TerminalRegistry {
  private controllers = new Map<string, TerminalController>()
  private unsubscribers: Array<() => void> = []
  private started = false
  private appearance: Settings | null = null
  private zoom = 0
  private zoomListeners = new Set<(zoom: number) => void>()
  private hydrated = new Set<string>()
  private pendingCommands = new Map<string, string>()

  init(): void {
    if (this.started) return
    this.started = true
    this.unsubscribers.push(
      window.voxterm.terminals.onData(({ sessionId, data }) => this.controllers.get(sessionId)?.write(data)),
      window.voxterm.terminals.onExit(({ sessionId, exitCode, signal }) =>
        this.controllers.get(sessionId)?.handleExit(exitCode, signal)
      )
    )
  }

  applyAppearance(settings: Settings): void {
    this.appearance = settings
    for (const controller of this.controllers.values()) {
      controller.setAppearance(settings, this.zoom)
    }
  }

  /** Transient zoom step in pixels, layered over the configured font size. */
  getZoom(): number {
    return this.zoom
  }

  /** The font size the terminal is actually rendering at. */
  effectiveFontSize(): number {
    return resolveFontSize(this.appearance?.appearance.terminalFontSize ?? DEFAULT_FONT_SIZE, this.zoom)
  }

  zoomBy(delta: number): void {
    this.setZoom(this.zoom + delta)
  }

  resetZoom(): void {
    this.setZoom(0)
  }

  /** Subscribe to zoom changes. Returns an unsubscribe function. */
  onZoomChange(listener: (zoom: number) => void): () => void {
    this.zoomListeners.add(listener)
    return () => {
      this.zoomListeners.delete(listener)
    }
  }

  private setZoom(next: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next)))
    if (clamped === this.zoom) return
    this.zoom = clamped
    if (this.appearance) this.applyAppearance(this.appearance)
    for (const listener of this.zoomListeners) listener(this.zoom)
  }

  /** Create (or reuse) the controller for a session and attach it to a container. */
  register(sessionId: string, container: HTMLElement, settings: Settings): TerminalController {
    this.appearance = this.appearance ?? settings
    let controller = this.controllers.get(sessionId)
    if (!controller) {
      controller = new TerminalController(sessionId, settings, this.zoom)
      this.controllers.set(sessionId, controller)
      const created = controller
      // Pull any output produced before this session was displayed, then play
      // back any command queued while the terminal was still spinning up.
      void window.voxterm.terminals.subscribe(sessionId).then((buffer) => {
        if (this.controllers.get(sessionId) !== created) return
        created.hydrate(buffer)
        this.hydrated.add(sessionId)
        const command = this.pendingCommands.get(sessionId)
        if (command) {
          this.pendingCommands.delete(sessionId)
          void window.voxterm.terminals.input(sessionId, `${command}\r`)
        }
      })
    }
    controller.attach(container)
    return controller
  }

  /**
   * Queue a command to be typed into a session once it is hydrated. Used to
   * launch coding agents as ordinary CLI programs inside a real shell.
   */
  queueCommand(sessionId: string, command: string): void {
    if (this.hydrated.has(sessionId)) {
      void window.voxterm.terminals.input(sessionId, `${command}\r`)
      return
    }
    this.pendingCommands.set(sessionId, command)
  }

  get(sessionId: string): TerminalController | undefined {
    return this.controllers.get(sessionId)
  }

  focus(sessionId: string): void {
    this.controllers.get(sessionId)?.focus()
  }

  refit(sessionId: string): void {
    this.controllers.get(sessionId)?.fitNow()
  }

  refitAll(): void {
    for (const controller of this.controllers.values()) controller.fitNow()
  }

  dispose(sessionId: string): void {
    const controller = this.controllers.get(sessionId)
    if (!controller) return
    controller.dispose()
    this.controllers.delete(sessionId)
    this.hydrated.delete(sessionId)
    this.pendingCommands.delete(sessionId)
  }

  /** Dispose controllers whose sessions no longer exist. */
  reconcile(activeIds: Set<string>): void {
    for (const id of [...this.controllers.keys()]) {
      if (!activeIds.has(id)) this.dispose(id)
    }
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId)
  }
}

export const terminalRegistry = new TerminalRegistry()
