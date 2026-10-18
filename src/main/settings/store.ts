import { app } from 'electron'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  SECRET_SLOTS,
  deepMerge,
  parseSettings,
  settingsSchema,
  type SecretSlot,
  type SecretsStatus,
  type Settings
} from '@shared/schemas'
import { JsonStore } from '../util/jsonStore'
import type { Logger } from '../util/logger'
import { envSecret, envValue } from './envSecrets'

interface SecretsFile {
  version: number
  values: Partial<Record<SecretSlot, string>>
}

type Listener = (settings: Settings) => void

/** Current on-disk settings version; bumped whenever a migration is added. */
export const SETTINGS_VERSION = 2

/**
 * One-time upgrade for settings written before cloud providers became the
 * requested default. Version 2:
 * - turns on the Google AI Studio (hosted Gemma) provider,
 * - clears both local-only switches so an explicitly configured cloud key is
 *   actually used,
 * - moves an old `Ctrl+F` voice hotkey off the key now reserved for find.
 */
function migrateSettings(settings: Settings): { settings: Settings; changed: boolean } {
  if (settings.version >= SETTINGS_VERSION) return { settings, changed: false }
  const hotkey = /^ctrl\s*\+\s*f$/i.test(settings.voice.hotkey.trim())
    ? 'Ctrl+Alt+Space'
    : settings.voice.hotkey
  return {
    changed: true,
    settings: {
      ...settings,
      version: SETTINGS_VERSION,
      voice: { ...settings.voice, hotkey },
      prompts: {
        ...settings.prompts,
        localOnly: false,
        google: { ...settings.prompts.google, enabled: true }
      },
      privacy: { ...settings.privacy, localOnlyMode: false }
    }
  }
}

/**
 * Fill non-secret fields from the environment when the user has not chosen a
 * value, so a `.env` file configures the app without any manual step. Only
 * values still equal to the built-in default are replaced; anything the user
 * has picked in Settings always wins. API keys are handled separately and are
 * never copied into settings.
 */
function applyEnvironmentDefaults(settings: Settings): Settings {
  let next = settings

  if (next.announcements.voiceId.trim().length === 0) {
    const voiceId = envValue('VOXTERM_ELEVENLABS_VOICE_ID')
    if (voiceId) next = { ...next, announcements: { ...next.announcements, voiceId } }
  }

  if (next.announcements.modelId === DEFAULT_SETTINGS.announcements.modelId) {
    const model = envValue('VOXTERM_ELEVENLABS_MODEL')
    if (model) next = { ...next, announcements: { ...next.announcements, modelId: model } }
  }

  if (next.prompts.google.model === DEFAULT_SETTINGS.prompts.google.model) {
    const model = envValue('VOXTERM_GOOGLE_MODEL')
    if (model) {
      next = { ...next, prompts: { ...next.prompts, google: { ...next.prompts.google, model } } }
    }
  }

  return next
}

/**
 * Loads, validates and persists user settings plus secret credentials.
 *
 * Secrets live in a separate owner-only file and are never returned through the
 * renderer API — only their presence is exposed as a boolean status.
 */
export class SettingsStore {
  private settings: Settings = DEFAULT_SETTINGS
  private secrets: SecretsFile = { version: 1, values: {} }
  private readonly settingsStore: JsonStore<unknown>
  private readonly secretsStore: JsonStore<SecretsFile>
  private listeners = new Set<Listener>()
  private recoveryIssues: string[] = []

  constructor(
    private readonly logger: Logger,
    baseDir = app.getPath('userData')
  ) {
    this.settingsStore = new JsonStore<unknown>(join(baseDir, 'settings.json'))
    this.secretsStore = new JsonStore<SecretsFile>(join(baseDir, 'secrets.json'))
  }

  get settingsFilePath(): string {
    return this.settingsStore.path
  }

  load(): Settings {
    const read = this.settingsStore.read()
    if (read.corrupted) {
      this.recoveryIssues = [`settings.json was invalid (${read.error ?? 'parse error'})`]
      this.logger.warn('settings', `Corrupted settings file backed up to ${read.backupPath ?? 'n/a'}`)
      this.settings = applyEnvironmentDefaults(migrateSettings(DEFAULT_SETTINGS).settings)
      this.settingsStore.write(this.settings)
    } else {
      const { settings, issues } = parseSettings(read.data)
      const migration = migrateSettings(settings)
      const merged = applyEnvironmentDefaults(migration.settings)
      const changed = migration.changed || merged !== migration.settings
      this.settings = merged
      this.recoveryIssues = issues
      if (issues.length > 0) {
        this.logger.warn('settings', `Recovered invalid settings fields: ${issues.join('; ')}`)
        this.settingsStore.write(this.settings)
      } else if (read.data === null || changed) {
        if (changed && migration.changed) {
          this.logger.info('settings', `Applied settings migration to version ${SETTINGS_VERSION}`)
        }
        this.settingsStore.write(this.settings)
      }
    }

    const secretsRead = this.secretsStore.read()
    if (secretsRead.corrupted) {
      this.logger.warn('settings', 'Corrupted secrets file backed up and reinitialised')
      this.secrets = { version: 1, values: {} }
      this.secretsStore.write(this.secrets)
    } else if (secretsRead.data) {
      this.secrets = { version: 1, values: secretsRead.data.values ?? {} }
    }
    return this.settings
  }

  getRecoveryIssues(): string[] {
    return [...this.recoveryIssues]
  }

  get(): Settings {
    return this.settings
  }

  secretsStatus(): SecretsStatus {
    const status = {} as SecretsStatus
    for (const slot of SECRET_SLOTS) {
      const stored = this.secrets.values[slot]
      status[slot] = Boolean((stored && stored.length > 0) || envSecret(slot))
    }
    return status
  }

  /**
   * Return a secret value for main-process use only. Never expose via IPC.
   * A credential saved through the UI takes precedence over an environment
   * default so the user can always override `.env` without editing it.
   */
  getSecret(slot: SecretSlot): string | null {
    const stored = this.secrets.values[slot]
    if (stored && stored.length > 0) return stored
    return envSecret(slot)
  }

  setSecret(slot: string, value: string): boolean {
    if (!SECRET_SLOTS.includes(slot as SecretSlot)) return false
    const typed = slot as SecretSlot
    const trimmed = value.trim()
    if (!trimmed) {
      delete this.secrets.values[typed]
    } else {
      this.secrets.values[typed] = trimmed
    }
    this.secretsStore.write(this.secrets)
    this.logger.info('settings', `Credential slot "${typed}" ${trimmed ? 'updated' : 'cleared'}`)
    return true
  }

  clearSecret(slot: string): boolean {
    if (!SECRET_SLOTS.includes(slot as SecretSlot)) return false
    delete this.secrets.values[slot as SecretSlot]
    this.secretsStore.write(this.secrets)
    return true
  }

  /**
   * Merge a partial patch over the current settings, validate the result and
   * persist it. Invalid patches are rejected and the previous settings kept.
   */
  update(patch: unknown): { ok: boolean; settings: Settings; error?: string } {
    const merged = deepMerge(this.settings, patch)
    const result = settingsSchema.safeParse(merged)
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      this.logger.warn('settings', `Rejected settings update: ${message}`)
      return { ok: false, settings: this.settings, error: message }
    }
    this.settings = result.data
    this.settingsStore.write(this.settings)
    this.emit()
    return { ok: true, settings: this.settings }
  }

  reset(): Settings {
    this.settings = DEFAULT_SETTINGS
    this.settingsStore.write(this.settings)
    this.emit()
    return this.settings
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.settings)
  }
}
