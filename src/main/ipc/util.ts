import type { z } from 'zod'

/** Validate a renderer-supplied payload, failing loudly with a useful message. */
export function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid IPC payload: ${detail}`)
  }
  return result.data
}
