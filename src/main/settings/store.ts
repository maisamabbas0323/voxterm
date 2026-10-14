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

interface SecretsFile {
  version: number
  values: Partial<Record<SecretSlot, string>>
}

type Listener = (settings: Settings) => void

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
      this.settings = DEFAULT_SETTINGS
      this.settingsStore.write(this.settings)
    } else {
      const { settings, issues } = parseSettings(read.data)
      this.settings = settings
      this.recoveryIssues = issues
      if (issues.length > 0) {
        this.logger.warn('settings', `Recovered invalid settings fields: ${issues.join('; ')}`)
        this.settingsStore.write(this.settings)
      } else if (read.data === null) {
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
      status[slot] = Boolean(this.secrets.values[slot] && this.secrets.values[slot]!.length > 0)
    }
    return status
  }

  /** Return a secret value for main-process use only. Never expose via IPC. */
  getSecret(slot: SecretSlot): string | null {
    return this.secrets.values[slot] ?? null
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
