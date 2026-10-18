import type { SecretSlot } from '@shared/schemas'

/**
 * Credentials may be supplied through the environment (for example a local
 * `.env` file loaded at startup) instead of being pasted into the app.
 *
 * Environment values are only ever read here, in the main process, and are
 * never sent to the renderer — the renderer still sees nothing but a boolean
 * "configured" flag. A value stored through the UI always wins, so a user can
 * override an environment default without editing the file.
 *
 * Accepted variable names, in priority order:
 *   google     — VOXTERM_GOOGLE_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY
 *   elevenlabs — VOXTERM_ELEVENLABS_API_KEY, ELEVENLABS_API_KEY
 */
const ENV_KEYS: Record<SecretSlot, readonly string[]> = {
  google: ['VOXTERM_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  elevenlabs: ['VOXTERM_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY']
}

/** First non-empty environment value for a slot, or null. */
export function envSecret(slot: SecretSlot): string | null {
  for (const name of ENV_KEYS[slot]) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/**
 * Optional non-secret defaults that pair with the environment secrets:
 *   VOXTERM_GOOGLE_MODEL             — Gemma model id (default gemma-4-31b-it)
 *   VOXTERM_ELEVENLABS_VOICE_ID      — ElevenLabs voice id
 *   VOXTERM_ELEVENLABS_MODEL         — ElevenLabs model id
 */
export function envValue(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
