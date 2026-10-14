import { z } from 'zod'
import { SECRET_SLOTS } from '@shared/schemas'
import { AGENT_ICON_NAMES } from '@shared/agents'
import { ENV_KEY_PATTERN, LAUNCH_COMMAND_PATTERN } from '../agents/profiles'

/** Payload validators for every IPC request that carries renderer input. */

const sessionId = z.string().uuid()
const title = z.string().trim().min(1).max(120)

export const terminalCreateSchema = z.object({
  shell: z
    .string()
    .max(300)
    .refine((value) => /^[A-Za-z0-9_./@:+-]*$/.test(value), 'Shell must be an executable path or name.')
    .optional(),
  args: z.array(z.string().max(500)).max(32).optional(),
  cwd: z.string().max(4096).optional(),
  cols: z.number().int().min(2).max(1000).optional(),
  rows: z.number().int().min(2).max(1000).optional(),
  title: z.string().max(120).optional(),
  env: z
    .record(z.string().regex(ENV_KEY_PATTERN), z.string().max(2000))
    .optional()
})

export const terminalInputSchema = z.object({
  sessionId,
  data: z.string().max(1_000_000)
})

export const terminalResizeSchema = z.object({
  sessionId,
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(2).max(1000)
})

export const terminalRenameSchema = z.object({ sessionId, title })

export const terminalCloseSchema = z.object({
  sessionId,
  mode: z.enum(['detach', 'terminate']).default('terminate')
})

export const settingsSecretSchema = z.object({
  slot: z.enum(SECRET_SLOTS),
  value: z.string().max(4096)
})

export const settingsSecretClearSchema = z.object({
  slot: z.enum(SECRET_SLOTS)
})

export const agentSaveSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(300).regex(LAUNCH_COMMAND_PATTERN),
  args: z.array(z.string().max(500)).max(32).optional(),
  description: z.string().max(300).optional(),
  icon: z.enum(AGENT_ICON_NAMES).optional(),
  env: z.record(z.string().regex(ENV_KEY_PATTERN), z.string().max(2000)).optional()
})

export const agentDeleteSchema = z.object({ id: z.string().min(1).max(80) })

export const externalIdSchema = z.string().min(1).max(600)

export const openExternalSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith('https://') || value.startsWith('http://'), 'Only http(s) URLs may be opened.')

export const revealPathSchema = z
  .string()
  .max(4096)
  .refine((value) => value.startsWith('/'), 'Path must be absolute.')
  .refine((value) => !value.includes('\0'), 'Path may not contain null bytes.')

export const clipboardWriteSchema = z.string().max(1_000_000)

export const respondCloseSchema = z.object({ confirm: z.boolean() })
