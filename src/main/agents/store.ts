import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@shared/types'
import { BUILTIN_AGENT_PROFILES } from '@shared/agents'
import { JsonStore } from '../util/jsonStore'
import { BUILTIN_CAPABILITIES, validateAgentProfileInput, type AgentProfileInput } from './profiles'
import type { Logger } from '../util/logger'

interface AgentsFile {
  version: number
  custom: AgentProfile[]
}

/**
 * Stores user-created agent profiles. Built-in profiles are always present and
 * cannot be overwritten. Opening or saving a profile never launches anything —
 * launching is an explicit user action performed in a real terminal session.
 */
export class AgentProfileStore {
  private custom: AgentProfile[] = []
  private readonly store: JsonStore<AgentsFile>

  constructor(
    private readonly logger: Logger,
    baseDir = app.getPath('userData')
  ) {
    this.store = new JsonStore<AgentsFile>(join(baseDir, 'agents.json'))
  }

  load(): void {
    const read = this.store.read()
    if (read.corrupted) {
      this.logger.warn('agents', 'Corrupted agents file backed up and reset')
      this.custom = []
      return
    }
    const list = read.data?.custom
    if (Array.isArray(list)) {
      this.custom = list.filter((profile): profile is AgentProfile => this.isValidStored(profile))
    }
  }

  private isValidStored(value: unknown): value is AgentProfile {
    if (!value || typeof value !== 'object') return false
    const candidate = value as AgentProfile
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false
    if (typeof candidate.command !== 'string') return false
    return /^[A-Za-z0-9_./@:+-]+$/.test(candidate.command)
  }

  all(): AgentProfile[] {
    return [...BUILTIN_AGENT_PROFILES, ...this.custom]
  }

  customProfiles(): AgentProfile[] {
    return [...this.custom]
  }

  isBuiltin(id: string): boolean {
    return BUILTIN_AGENT_PROFILES.some((profile) => profile.id === id)
  }

  /** Create or update a custom profile after validating the launch command. */
  save(input: AgentProfileInput): { ok: boolean; profiles: AgentProfile[]; error?: string } {
    const validation = validateAgentProfileInput(input)
    if (!validation.ok || !validation.profile) {
      return { ok: false, profiles: this.all(), error: validation.error }
    }
    const value = validation.profile
    if (value.id && this.isBuiltin(value.id)) {
      return { ok: false, profiles: this.all(), error: 'Built-in profiles cannot be modified.' }
    }

    const existingIndex = value.id ? this.custom.findIndex((profile) => profile.id === value.id) : -1
    const profile: AgentProfile = {
      id: existingIndex >= 0 ? this.custom[existingIndex].id : `custom-${randomUUID()}`,
      name: value.name,
      command: value.command,
      args: value.args,
      description: value.description,
      icon: value.icon,
      env: value.env,
      kind: 'custom',
      capabilities: { ...BUILTIN_CAPABILITIES }
    }

    if (existingIndex >= 0) {
      this.custom[existingIndex] = profile
    } else {
      this.custom.push(profile)
    }
    this.persist()
    this.logger.info('agents', `Saved custom agent profile "${profile.name}"`)
    return { ok: true, profiles: this.all() }
  }

  delete(id: string): { ok: boolean; profiles: AgentProfile[]; error?: string } {
    if (this.isBuiltin(id)) {
      return { ok: false, profiles: this.all(), error: 'Built-in profiles cannot be deleted.' }
    }
    const before = this.custom.length
    this.custom = this.custom.filter((profile) => profile.id !== id)
    if (this.custom.length === before) {
      return { ok: false, profiles: this.all(), error: 'Profile not found.' }
    }
    this.persist()
    return { ok: true, profiles: this.all() }
  }

  private persist(): void {
    try {
      this.store.write({ version: 1, custom: this.custom })
    } catch (error) {
      this.logger.warn('agents', `Failed to persist agent profiles: ${String(error)}`)
    }
  }
}
