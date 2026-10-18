import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envSecret, envValue } from '../src/main/settings/envSecrets'
import { loadEnvFile } from '../src/main/settings/loadEnv'

/**
 * The `.env` path is what lets a user configure credentials without pasting
 * them into the GUI. These tests pin the two halves: the variable-name mapping
 * and the file parser.
 */

const MANAGED = [
  'VOXTERM_GOOGLE_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'VOXTERM_ELEVENLABS_API_KEY',
  'ELEVENLABS_API_KEY',
  'VOXTERM_GOOGLE_MODEL',
  'VOXTERM_ELEVENLABS_VOICE_ID'
]

const saved: Record<string, string | undefined> = {}
let dir = ''

beforeEach(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  dir = mkdtempSync(join(tmpdir(), 'voxterm-env-'))
})

afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('envSecret', () => {
  it('returns null when nothing is set', () => {
    expect(envSecret('google')).toBeNull()
    expect(envSecret('elevenlabs')).toBeNull()
  })

  it('reads the preferred VOXTERM_ prefixed name first', () => {
    process.env.GOOGLE_API_KEY = 'fallback'
    process.env.VOXTERM_GOOGLE_API_KEY = 'preferred'
    expect(envSecret('google')).toBe('preferred')
  })

  it('falls back to the conventional aliases', () => {
    process.env.GEMINI_API_KEY = 'gemini-key'
    expect(envSecret('google')).toBe('gemini-key')
    process.env.ELEVENLABS_API_KEY = 'eleven-key'
    expect(envSecret('elevenlabs')).toBe('eleven-key')
  })

  it('ignores empty and whitespace-only values and trims real ones', () => {
    process.env.VOXTERM_GOOGLE_API_KEY = '   '
    process.env.GOOGLE_API_KEY = '  real-key  '
    expect(envSecret('google')).toBe('real-key')
  })
})

describe('envValue', () => {
  it('returns a trimmed non-secret value or null', () => {
    expect(envValue('VOXTERM_ELEVENLABS_VOICE_ID')).toBeNull()
    process.env.VOXTERM_ELEVENLABS_VOICE_ID = '  voice-123  '
    expect(envValue('VOXTERM_ELEVENLABS_VOICE_ID')).toBe('voice-123')
  })
})

describe('loadEnvFile', () => {
  function write(body: string): string {
    const file = join(dir, '.env')
    writeFileSync(file, body)
    return file
  }

  it('returns false when the file does not exist', () => {
    expect(loadEnvFile(join(dir, 'missing.env'))).toBe(false)
  })

  it('parses KEY=value, comments, blanks and an optional export prefix', () => {
    const file = write(
      ['# a comment', '', 'VOXTERM_GOOGLE_API_KEY=abc123', 'export GOOGLE_API_KEY=def456', '   '].join('\n')
    )
    expect(loadEnvFile(file)).toBe(true)
    expect(process.env.VOXTERM_GOOGLE_API_KEY).toBe('abc123')
    expect(process.env.GOOGLE_API_KEY).toBe('def456')
  })

  it('strips surrounding quotes and unquoted trailing comments', () => {
    const file = write(
      [
        'A="double quoted value"',
        "B='single quoted'",
        'C=bare # trailing comment',
        'D="keeps # hash inside"'
      ].join('\n')
    )
    loadEnvFile(file)
    expect(process.env.A).toBe('double quoted value')
    expect(process.env.B).toBe('single quoted')
    expect(process.env.C).toBe('bare')
    expect(process.env.D).toBe('keeps # hash inside')
    delete process.env.A
    delete process.env.B
    delete process.env.C
    delete process.env.D
  })

  it('never overwrites a variable already present in the real environment', () => {
    process.env.VOXTERM_GOOGLE_API_KEY = 'from-shell'
    const file = write('VOXTERM_GOOGLE_API_KEY=from-file')
    loadEnvFile(file)
    expect(process.env.VOXTERM_GOOGLE_API_KEY).toBe('from-shell')
  })

  it('ignores malformed lines without throwing', () => {
    const file = write(['not a pair', '=noKey', '1BAD=x', 'GOOD=yes'].join('\n'))
    expect(() => loadEnvFile(file)).not.toThrow()
    expect(process.env.GOOD).toBe('yes')
    delete process.env.GOOD
  })
})
