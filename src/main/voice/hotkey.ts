import type { VoiceHotkeyMode } from '@shared/types'
import type { Logger } from '../util/logger'

/**
 * Global voice hotkey.
 *
 * `uiohook-napi` (libuiohook) is the only mechanism that reports genuine
 * key-down *and* key-up events, so it is what makes true push-to-talk possible.
 * It needs an X11 session; when the hook cannot start (Wayland, headless CI) we
 * fall back to Electron's `globalShortcut`, which only reports presses — so the
 * mode honestly becomes "toggle" instead of pretending to be hold-to-talk.
 */

/** Canonical key names the hotkey parser understands. */
const KEY_ALIASES: Record<string, string> = {
  space: 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  minus: 'Minus',
  '-': 'Minus',
  equal: 'Equal',
  '=': 'Equal',
  semicolon: 'Semicolon',
  ';': 'Semicolon',
  comma: 'Comma',
  ',': 'Comma',
  period: 'Period',
  '.': 'Period',
  slash: 'Slash',
  '/': 'Slash',
  backquote: 'Backquote',
  '`': 'Backquote',
  bracketleft: 'BracketLeft',
  '[': 'BracketLeft',
  backslash: 'Backslash',
  '\\': 'Backslash',
  bracketright: 'BracketRight',
  ']': 'BracketRight',
  quote: 'Quote',
  "'": 'Quote'
}

export interface HotkeySpec {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  /** Canonical key name (e.g. "Space", "A", "F5"). */
  key: string
}

export type HotkeyParseResult = { ok: true; spec: HotkeySpec } | { ok: false; error: string }

/** Normalise a single key token to a canonical name, or null when unknown. */
export function normalizeKeyToken(token: string): string | null {
  const value = token.trim().toLowerCase()
  if (!value) return null
  if (/^[a-z]$/.test(value)) return value.toUpperCase()
  if (/^[0-9]$/.test(value)) return value
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(value)) return value.toUpperCase()
  if (/^numpad[0-9]$/.test(value)) return value.charAt(0).toUpperCase() + value.slice(1)
  return KEY_ALIASES[value] ?? null
}

/**
 * Parse a chord such as "Ctrl+Alt+Space" into a structured spec. Pure, so the
 * parsing rules are unit-testable without touching the native hook.
 */
export function parseHotkey(chord: string): HotkeyParseResult {
  const tokens = chord
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return { ok: false, error: 'The hotkey is empty.' }

  const spec: HotkeySpec = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const token of tokens) {
    const lowered = token.toLowerCase()
    if (lowered === 'ctrl' || lowered === 'control') {
      spec.ctrl = true
      continue
    }
    if (lowered === 'alt' || lowered === 'option') {
      spec.alt = true
      continue
    }
    if (lowered === 'shift') {
      spec.shift = true
      continue
    }
    if (lowered === 'meta' || lowered === 'cmd' || lowered === 'command' || lowered === 'super' || lowered === 'win') {
      spec.meta = true
      continue
    }
    const key = normalizeKeyToken(token)
    if (!key) return { ok: false, error: `Unsupported key "${token}".` }
    if (spec.key && spec.key !== key) return { ok: false, error: 'A hotkey can contain only one non-modifier key.' }
    spec.key = key
  }

  if (!spec.key) return { ok: false, error: 'Add a key to the shortcut (for example Ctrl+Alt+Space).' }
  if (!spec.ctrl && !spec.alt && !spec.meta) {
    return { ok: false, error: 'Use at least one modifier (Ctrl, Alt or Meta) so the hotkey does not interfere with typing.' }
  }
  return { ok: true, spec }
}

/** Event shape shared by libuiohook and our own tests. */
export interface HotkeyEventLike {
  keycode: number
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Does a keyboard event match the spec? `lookup` resolves a canonical key name
 * to a platform keycode so this stays independent of the native enum.
 */
export function matchesHotkey(
  event: HotkeyEventLike,
  spec: HotkeySpec,
  lookup: (name: string) => number | undefined
): boolean {
  if (event.ctrlKey !== spec.ctrl) return false
  if (event.altKey !== spec.alt) return false
  if (event.shiftKey !== spec.shift) return false
  if (event.metaKey !== spec.meta) return false
  const code = lookup(spec.key)
  return code !== undefined && code === event.keycode
}

/** Electron accelerator string for the fallback binding. */
export function toAccelerator(spec: HotkeySpec): string {
  const parts: string[] = []
  if (spec.ctrl) parts.push('Control')
  if (spec.alt) parts.push('Alt')
  if (spec.shift) parts.push('Shift')
  if (spec.meta) parts.push('Super')
  const key = spec.key === 'ArrowUp' ? 'Up'
    : spec.key === 'ArrowDown' ? 'Down'
    : spec.key === 'ArrowLeft' ? 'Left'
    : spec.key === 'ArrowRight' ? 'Right'
    : spec.key === 'Escape' ? 'Esc'
    : spec.key
  parts.push(key)
  return parts.join('+')
}

export type HotkeySignal = 'down' | 'up' | 'toggle'

export interface HotkeyRegistration {
  registered: boolean
  mode: VoiceHotkeyMode
  error: string | null
}

type UiohookModule = typeof import('uiohook-napi')

/**
 * Owns the global hook for the lifetime of the process. Only one hotkey is ever
 * registered (the settings value), and the hook is stopped whenever voice is
 * disabled so VoxTerm is not listening to the keyboard when it has no reason to.
 */
export class VoiceHotkey {
  private module: UiohookModule | null = null
  private loaded = false
  private started = false
  private spec: HotkeySpec | null = null
  private mode: VoiceHotkeyMode = 'unavailable'
  private error: string | null = null
  private pressed = false
  private accelerator: string | null = null

  constructor(
    private readonly onSignal: (signal: HotkeySignal) => void,
    private readonly logger: Logger,
    private readonly globalShortcut: {
      register: (accelerator: string, callback: () => void) => boolean
      unregister: (accelerator: string) => void
    } | null
  ) {}

  get currentMode(): VoiceHotkeyMode {
    return this.mode
  }

  get currentError(): string | null {
    return this.error
  }

  /** Attempt to load the native hook once. */
  private load(): UiohookModule | null {
    if (this.loaded) return this.module
    this.loaded = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.module = require('uiohook-napi') as UiohookModule
    } catch (error) {
      this.logger.info('voice', `Global keyboard hook unavailable: ${error instanceof Error ? error.message : String(error)}`)
      this.module = null
    }
    return this.module
  }

  private handleKey = (event: HotkeyEventLike, type: 'down' | 'up'): void => {
    if (!this.spec) return
    const module = this.module
    if (!module) return
    const lookup = (name: string): number | undefined =>
      (module.UiohookKey as unknown as Record<string, number>)[name]
    if (!matchesHotkey(event, this.spec, lookup)) return

    if (this.mode === 'hold') {
      if (type === 'down') {
        if (this.pressed) return
        this.pressed = true
        this.onSignal('down')
      } else if (this.pressed) {
        this.pressed = false
        this.onSignal('up')
      }
      return
    }
    // Toggle mode using the raw hook (rare: only when the user chose toggle).
    if (type === 'down') this.onSignal('toggle')
  }

  /**
   * Register the configured chord. `pushToTalk` requests hold-to-talk; when the
   * native hook is unavailable that downgrades to a toggle binding and says so.
   */
  register(chord: string, pushToTalk: boolean): HotkeyRegistration {
    this.unregister()
    const parsed = parseHotkey(chord)
    if (!parsed.ok) {
      this.mode = 'unavailable'
      this.error = parsed.error
      return { registered: false, mode: this.mode, error: this.error }
    }
    this.spec = parsed.spec

    const module = this.load()
    if (module) {
      try {
        module.uIOhook.on('keydown', (event) => this.handleKey(event, 'down'))
        module.uIOhook.on('keyup', (event) => this.handleKey(event, 'up'))
        module.uIOhook.start()
        this.started = true
        this.mode = pushToTalk ? 'hold' : 'toggle'
        this.error = null
        this.logger.info('voice', `Voice hotkey registered (${this.mode}) via the global hook`)
        return { registered: true, mode: this.mode, error: null }
      } catch (error) {
        this.releaseModuleListeners()
        this.error = error instanceof Error ? error.message : String(error)
        this.logger.info('voice', `Global hook failed to start: ${this.error}`)
      }
    }

    // Fallback: Electron global shortcut. Presses only, so the mode is 'toggle'.
    const accelerator = toAccelerator(parsed.spec)
    if (this.globalShortcut) {
      try {
        const ok = this.globalShortcut.register(accelerator, () => this.onSignal('toggle'))
        if (ok) {
          this.accelerator = accelerator
          this.mode = 'toggle'
          this.error =
            'Hold-to-talk needs a global keyboard hook, which is unavailable here, so the hotkey now toggles recording. On Linux this usually means a Wayland session; X11 (or the XWayland hook) enables push-to-talk.'
          this.logger.info('voice', `Voice hotkey registered as a toggle (${accelerator})`)
          return { registered: true, mode: this.mode, error: this.error }
        }
        this.error = `The system refused to register ${accelerator}; another application may already own it.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    } else {
      this.error = 'The global keyboard hook is unavailable and no fallback is configured.'
    }

    this.mode = 'unavailable'
    return { registered: false, mode: this.mode, error: this.error }
  }

  private releaseModuleListeners(): void {
    const module = this.module
    if (!module) return
    try {
      module.uIOhook.removeAllListeners('keydown')
      module.uIOhook.removeAllListeners('keyup')
    } catch {
      /* ignore */
    }
  }

  unregister(): void {
    const module = this.module
    if (this.started && module) {
      this.releaseModuleListeners()
      try {
        module.uIOhook.stop()
      } catch (error) {
        this.logger.info('voice', `Stopping the global hook failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (this.accelerator && this.globalShortcut) {
      try {
        this.globalShortcut.unregister(this.accelerator)
      } catch {
        /* ignore */
      }
    }
    this.started = false
    this.accelerator = null
    this.pressed = false
    this.spec = null
    this.mode = 'unavailable'
    this.error = null
  }

  dispose(): void {
    this.unregister()
    // A started hook cannot be restarted inside the same process reliably, so
    // keep the module cached but never flip `started` back to true.
    this.module = null
    this.loaded = true
  }
}
