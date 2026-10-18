import { z } from 'zod'

/**
 * Persisted user settings. Every field has a default so that malformed or
 * partial configuration can be recovered safely without discarding unrelated
 * user data.
 */

const fontFamily = z.string().min(1).max(200)
const directory = z.string().max(4096)

export const appearanceSettingsSchema = z.object({
  theme: z.enum(['voxterm', 'voxterm-contrast']).default('voxterm'),
  terminalFontFamily: fontFamily.default(
    '"JetBrains Mono", "JetBrainsMono Nerd Font", "Fira Code", monospace'
  ),
  terminalFontSize: z.number().int().min(8).max(32).default(13),
  terminalLineHeight: z.number().min(1).max(2.5).default(1.2),
  cursorStyle: z.enum(['block', 'underline', 'bar']).default('block'),
  cursorBlink: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  animationIntensity: z.enum(['none', 'subtle', 'full']).default('subtle'),
  interfaceDensity: z.enum(['comfortable', 'compact']).default('comfortable')
})

export const terminalSettingsSchema = z.object({
  /** Empty string means "auto-detect". */
  defaultShell: directory.default(''),
  /** Empty string means the user's home directory. */
  startupDirectory: directory.default(''),
  scrollback: z.number().int().min(100).max(200000).default(5000),
  confirmBeforeTerminate: z.boolean().default(true),
  confirmBeforeAppClose: z.boolean().default(true),
  newTerminalBehavior: z.enum(['home', 'active-session-cwd', 'configured']).default('home'),
  copyOnSelect: z.boolean().default(false),
  rightClickPaste: z.boolean().default(false),
  detectLinks: z.boolean().default(true),
  fontLigatures: z.boolean().default(false)
})

export const voiceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** A single hotkey chord, e.g. "Ctrl+Alt+Space". */
  hotkey: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9+ -]*$/, 'Hotkey may only contain letters, digits, "+", "-" and spaces')
    .default('Ctrl+Alt+Space'),
  pushToTalk: z.boolean().default(true),
  /** ElevenLabs speech-to-text model, e.g. "scribe_v1". */
  sttModelId: z.string().max(80).default('scribe_v1'),
  /** ISO-639 language hint, or "auto" to let the service detect it. */
  language: z.string().max(32).default('auto'),
  /** Minimum capture length accepted for transcription, in milliseconds. */
  minRecordingMs: z.number().int().min(300).max(10000).default(700),
  /**
   * After a hotkey transcription, immediately send the transcript to the
   * configured Gemma provider and use the rewritten prompt.
   */
  autoEnhance: z.boolean().default(true),
  /** Insert the finished text into the active terminal without an extra click. */
  autoInsert: z.boolean().default(true),
  /**
   * Only react to the push-to-talk hotkey while the Terminals view is open, so
   * a stray key press anywhere else can never open the microphone.
   */
  terminalOnly: z.boolean().default(true)
})

export const promptProviderSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().max(500).default(''),
  model: z.string().max(200).default('')
})

export const promptSettingsSchema = z.object({
  priority: z
    .array(z.enum(['ollama', 'google']))
    .max(2)
    .default(['ollama', 'google']),
  localOnly: z.boolean().default(true),
  reviewBeforeSend: z.boolean().default(true),
  /** Send a bounded list of workspace file names as context. */
  projectContext: z.boolean().default(false),
  /** Per-request timeout for a provider call, in seconds. */
  timeoutSeconds: z.number().int().min(10).max(300).default(60),
  ollama: promptProviderSchema.default({ enabled: true, baseUrl: 'http://127.0.0.1:11434', model: '' }),
  google: promptProviderSchema.default({
    enabled: false,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemma-4-31b-it'
  })
})

/** Events VoxTerm can genuinely confirm are worth announcing. */
export const ANNOUNCEMENT_CATEGORIES = ['session-exit', 'error', 'agent-event'] as const
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number]

export const announcementSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  muted: z.boolean().default(false),
  voiceId: z.string().max(200).default(''),
  modelId: z.string().max(80).default('eleven_multilingual_v2'),
  volume: z.number().min(0).max(1).default(0.8),
  rate: z.number().min(0.5).max(2).default(1),
  /** Only events VoxTerm can genuinely confirm are offered. */
  eventCategories: z
    .array(z.enum(ANNOUNCEMENT_CATEGORIES))
    .max(16)
    .default(['error'])
})

export const externalSettingsSchema = z.object({
  discoverTmux: z.boolean().default(true),
  discoverScreen: z.boolean().default(true),
  /** Ask before attaching to a multiplexer session. */
  confirmAttach: z.boolean().default(true)
})

export const privacySettingsSchema = z.object({
  localOnlyMode: z.boolean().default(true),
  diagnosticLogging: z.boolean().default(false),
  redactLogs: z.boolean().default(true),
  logTerminalOutput: z.boolean().default(false),
  sessionCleanupOnExit: z.enum(['terminate-managed', 'ask', 'keep-managed']).default('ask'),
  activityRetention: z.number().int().min(0).max(10000).default(500)
})

export const settingsSchema = z.object({
  version: z.number().int().min(1).default(2),
  appearance: appearanceSettingsSchema.default(() => appearanceSettingsSchema.parse({})),
  terminal: terminalSettingsSchema.default(() => terminalSettingsSchema.parse({})),
  voice: voiceSettingsSchema.default(() => voiceSettingsSchema.parse({})),
  prompts: promptSettingsSchema.default(() => promptSettingsSchema.parse({})),
  announcements: announcementSettingsSchema.default(() => announcementSettingsSchema.parse({})),
  external: externalSettingsSchema.default(() => externalSettingsSchema.parse({})),
  privacy: privacySettingsSchema.default(() => privacySettingsSchema.parse({}))
})

export type Settings = z.infer<typeof settingsSchema>
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>
export type PromptSettings = z.infer<typeof promptSettingsSchema>
export type AnnouncementSettings = z.infer<typeof announcementSettingsSchema>
export type ExternalSettings = z.infer<typeof externalSettingsSchema>
export type PrivacySettings = z.infer<typeof privacySettingsSchema>

/** Settings section identifiers used by the Settings page navigation. */
export const SETTINGS_SECTIONS = [
  'appearance',
  'terminal',
  'voice',
  'prompts',
  'announcements',
  'external',
  'privacy',
  'system'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/** Names of credential slots. Values are never returned to the renderer. */
export const SECRET_SLOTS = ['google', 'elevenlabs'] as const
export type SecretSlot = (typeof SECRET_SLOTS)[number]

export type SecretsStatus = Record<SecretSlot, boolean>

/**
 * Recursively merge a partial update into a base object, ignoring keys that
 * could pollute the prototype. Arrays and primitives replace wholesale.
 */
export function deepMerge<T>(base: T, update: unknown): T {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) {
    return (update as T) ?? base
  }
  const baseObject = (base && typeof base === 'object' && !Array.isArray(base) ? base : {}) as Record<
    string,
    unknown
  >
  const result: Record<string, unknown> = { ...baseObject }
  for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const current = result[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(current, value)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

/**
 * Validate an arbitrary value (typically read from disk) against the settings
 * schema. Returns the parsed settings plus a list of human-readable issues.
 *
 * Recovery is section-scoped: a section that still fails after merging over
 * defaults is reset to its defaults, without discarding unrelated sections.
 */
export function parseSettings(input: unknown): { settings: Settings; issues: string[] } {
  const result = settingsSchema.safeParse(input ?? {})
  if (result.success) {
    return { settings: result.data, issues: [] }
  }
  const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)

  const raw =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

  const version =
    typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1
      ? raw.version
      : DEFAULT_SETTINGS.version

  const settings: Settings = {
    version,
    appearance: recoverSection(appearanceSettingsSchema, DEFAULT_SETTINGS.appearance, raw.appearance),
    terminal: recoverSection(terminalSettingsSchema, DEFAULT_SETTINGS.terminal, raw.terminal),
    voice: recoverSection(voiceSettingsSchema, DEFAULT_SETTINGS.voice, raw.voice),
    prompts: recoverSection(promptSettingsSchema, DEFAULT_SETTINGS.prompts, raw.prompts),
    announcements: recoverSection(announcementSettingsSchema, DEFAULT_SETTINGS.announcements, raw.announcements),
    external: recoverSection(externalSettingsSchema, DEFAULT_SETTINGS.external, raw.external),
    privacy: recoverSection(privacySettingsSchema, DEFAULT_SETTINGS.privacy, raw.privacy)
  }
  return { settings, issues }
}

/** Merge a candidate section over its defaults and validate; fall back on failure. */
function recoverSection<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  defaults: T,
  candidate: unknown
): T {
  const parsed = schema.safeParse(deepMerge(defaults, candidate))
  return parsed.success ? parsed.data : defaults
}
