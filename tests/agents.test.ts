import { describe, expect, it } from 'vitest'
import { validateAgentProfileInput } from '../src/main/agents/profiles'

describe('agent profile validation', () => {
  it('accepts a plain executable with arguments', () => {
    const result = validateAgentProfileInput({
      name: 'Codex',
      command: '/usr/local/bin/codex',
      args: ['--model', 'gpt-5']
    })
    expect(result.ok).toBe(true)
    expect(result.profile?.command).toBe('/usr/local/bin/codex')
    expect(result.profile?.args).toEqual(['--model', 'gpt-5'])
  })

  it('rejects shell pipelines and metacharacters in the command', () => {
    for (const command of ['rm -rf /', 'echo hi | cat', 'a;b', '$(whoami)', 'a && b', 'cmd>file']) {
      expect(validateAgentProfileInput({ name: 'x', command }).ok, command).toBe(false)
    }
  })

  it('rejects newlines inside arguments', () => {
    const result = validateAgentProfileInput({ name: 'x', command: 'codex', args: ['a\nb'] })
    expect(result.ok).toBe(false)
  })

  it('rejects invalid environment keys', () => {
    const result = validateAgentProfileInput({
      name: 'x',
      command: 'codex',
      env: { 'not-a-key': 'value' }
    })
    expect(result.ok).toBe(false)
  })

  it('accepts valid environment overrides', () => {
    const result = validateAgentProfileInput({
      name: 'x',
      command: 'codex',
      env: { OPENAI_API_KEY: 'secret' }
    })
    expect(result.ok).toBe(true)
    expect(result.profile?.env).toEqual({ OPENAI_API_KEY: 'secret' })
  })

  it('rejects an unknown icon name', () => {
    const result = validateAgentProfileInput({ name: 'x', command: 'codex', icon: 'Robot' })
    expect(result.ok).toBe(false)
  })
})
