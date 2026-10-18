import { describe, expect, it } from 'vitest'
import {
  agentSaveSchema,
  openExternalSchema,
  revealPathSchema,
  settingsSecretSchema,
  terminalCreateSchema,
  terminalResizeSchema
} from '../src/main/ipc/schemas'

describe('IPC payload validation', () => {
  it('rejects shell strings containing shell syntax', () => {
    expect(terminalCreateSchema.safeParse({ shell: '/bin/bash; rm -rf /' }).success).toBe(false)
    expect(terminalCreateSchema.safeParse({ shell: '/bin/bash' }).success).toBe(true)
  })

  it('clamps terminal dimensions', () => {
    expect(terminalResizeSchema.safeParse({ sessionId: crypto.randomUUID(), cols: 1, rows: 24 }).success).toBe(false)
    expect(terminalResizeSchema.safeParse({ sessionId: crypto.randomUUID(), cols: 80, rows: 24 }).success).toBe(true)
  })

  it('rejects unknown credential slots', () => {
    expect(settingsSecretSchema.safeParse({ slot: 'unknown', value: 'x' }).success).toBe(false)
    // OpenRouter was removed from the product; its old slot must stay rejected.
    expect(settingsSecretSchema.safeParse({ slot: 'openrouter', value: 'x' }).success).toBe(false)
    expect(settingsSecretSchema.safeParse({ slot: 'google', value: 'x' }).success).toBe(true)
    expect(settingsSecretSchema.safeParse({ slot: 'elevenlabs', value: 'x' }).success).toBe(true)
  })

  it('only permits http(s) URLs for external opening', () => {
    expect(openExternalSchema.safeParse('file:///etc/passwd').success).toBe(false)
    expect(openExternalSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(openExternalSchema.safeParse('https://example.com').success).toBe(true)
  })

  it('requires absolute, null-free reveal paths', () => {
    expect(revealPathSchema.safeParse('relative/path').success).toBe(false)
    expect(revealPathSchema.safeParse('/tmp/file\u0000').success).toBe(false)
    expect(revealPathSchema.safeParse('/tmp/file').success).toBe(true)
  })

  it('validates saved agent profiles', () => {
    expect(agentSaveSchema.safeParse({ name: 'X', command: 'codex', icon: 'Bot' }).success).toBe(true)
    expect(agentSaveSchema.safeParse({ name: 'X', command: 'codex', icon: 'NotAnIcon' }).success).toBe(false)
    expect(agentSaveSchema.safeParse({ name: 'X', command: 'a;b' }).success).toBe(false)
  })
})
