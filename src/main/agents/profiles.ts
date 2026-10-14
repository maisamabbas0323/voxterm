import { z } from 'zod'
import type { AgentCapabilities, AgentProfile, AgentProfileStatus } from '@shared/types'
import { AGENT_ICON_NAMES } from '@shared/agents'
import { detectToolVersion, findExecutable } from '../util/exec'

/**
 * A launch command is an executable plus arguments — never a shell pipeline.
 * The command token is restricted to characters that appear in real
 * executable names and paths so that user input can never become shell syntax.
 */
export const LAUNCH_COMMAND_PATTERN = /^[A-Za-z0-9_./@:+-]+$/
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const agentProfileInputSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().trim().min(1).max(80),
  command: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(LAUNCH_COMMAND_PATTERN, 'Launch command must be a single executable token without shell syntax.'),
  args: z
    .array(z.string().max(500).refine((value) => !/[\r\n]/.test(value), 'Arguments may not contain newlines.'))
    .max(32)
    .optional()
    .default([]),
  description: z.string().max(300).optional(),
  icon: z.enum(AGENT_ICON_NAMES).optional(),
  env: z
    .record(
      z.string().regex(ENV_KEY_PATTERN, 'Environment keys must be valid identifiers.'),
      z.string().max(2000)
    )
    .optional()
})

export type AgentProfileInput = z.input<typeof agentProfileInputSchema>

export interface ValidationResult {
  ok: boolean
  profile?: Omit<AgentProfile, 'kind' | 'capabilities'>
  error?: string
}

export function validateAgentProfileInput(input: unknown): ValidationResult {
  const result = agentProfileInputSchema.safeParse(input)
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    }
  }
  const value = result.data
  return {
    ok: true,
    profile: {
      id: value.id ?? '',
      name: value.name,
      command: value.command,
      args: value.args ?? [],
      description: value.description,
      icon: value.icon,
      env: value.env
    }
  }
}

interface CacheEntry {
  status: AgentProfileStatus
  at: number
}

const CACHE_TTL_MS = 30_000
const detectionCache = new Map<string, CacheEntry>()

export function invalidateAgentCache(): void {
  detectionCache.clear()
}

/**
 * Determine whether an agent's executable is genuinely installed and, if so,
 * capture its resolved path and version. Results are cached briefly because
 * version detection spawns a process.
 */
export async function detectAgentProfile(
  profile: AgentProfile,
  pathValue: string
): Promise<AgentProfileStatus> {
  const key = `${profile.id}:${pathValue}`
  const cached = detectionCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.status
  }

  const resolvedPath = await findExecutable(profile.command, pathValue)
  const version = resolvedPath ? await detectToolVersion(resolvedPath, ['--version']) : null
  const status: AgentProfileStatus = {
    ...profile,
    available: Boolean(resolvedPath),
    resolvedPath,
    version
  }
  detectionCache.set(key, { status, at: Date.now() })
  return status
}

export const BUILTIN_CAPABILITIES: AgentCapabilities = {
  promptInjection: false,
  structuredEvents: false
}
