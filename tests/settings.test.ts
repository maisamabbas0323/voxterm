import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, deepMerge, parseSettings, settingsSchema } from '@shared/schemas'

describe('settings schema', () => {
  it('produces a complete default configuration from an empty object', () => {
    const { settings, issues } = parseSettings({})
    expect(issues).toEqual([])
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.terminal.scrollback).toBe(5000)
    expect(settings.appearance.terminalFontSize).toBe(13)
    expect(settings.privacy.sessionCleanupOnExit).toBe('ask')
  })

  it('accepts a fully valid configuration unchanged', () => {
    const input = settingsSchema.parse({})
    input.terminal.scrollback = 12000
    input.appearance.reducedMotion = true
    const { settings, issues } = parseSettings(input)
    expect(issues).toEqual([])
    expect(settings.terminal.scrollback).toBe(12000)
    expect(settings.appearance.reducedMotion).toBe(true)
  })
})

describe('parseSettings recovery', () => {
  it('never throws on a corrupted section and resets only that section', () => {
    const { settings, issues } = parseSettings({
      terminal: { scrollback: 5, confirmBeforeAppClose: false },
      privacy: { activityRetention: 50 }
    })
    expect(issues.length).toBeGreaterThan(0)
    // The corrupted section is reset to defaults...
    expect(settings.terminal.scrollback).toBe(DEFAULT_SETTINGS.terminal.scrollback)
    // ...while the unrelated, valid section is preserved.
    expect(settings.privacy.activityRetention).toBe(50)
    expect(settings.appearance).toEqual(DEFAULT_SETTINGS.appearance)
  })

  it('recovers from non-object input', () => {
    const { settings } = parseSettings('not-an-object')
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('repairs a wrong version field', () => {
    const { settings } = parseSettings({ version: -3 })
    expect(settings.version).toBe(DEFAULT_SETTINGS.version)
  })
})

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays wholesale', () => {
    const base = { a: { b: 1, c: 2 }, list: [1, 2, 3] }
    const merged = deepMerge(base, { a: { c: 9 }, list: [4] })
    expect(merged).toEqual({ a: { b: 1, c: 9 }, list: [4] })
  })

  it('ignores prototype-polluting keys', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"safe":42}')
    const result = deepMerge({ safe: 0 } as Record<string, unknown>, hostile)
    expect(result.safe).toBe(42)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
