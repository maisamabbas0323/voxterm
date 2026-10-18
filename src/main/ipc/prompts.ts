import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { ActivityLog } from '../activity/log'
import type { PromptService } from '../prompts/service'
import { parseOrThrow } from './util'

/**
 * Renderer-facing prompt handlers. Payloads are validated with schemas defined
 * locally here (never renderer input beyond these bounds), and activity entries
 * carry only non-sensitive metadata — provider, outcome, timings and character
 * counts. The transcript text itself never reaches the activity log.
 */

const promptProviderIdSchema = z.enum(['ollama', 'google'])

const promptsTestSchema = z.object({ id: promptProviderIdSchema })

/** A dictation is far below this; anything larger is rejected up front. */
const MAX_TRANSCRIPT_CHARS = 10_000
const MAX_CWD_CHARS = 4_096

const promptsEnhanceSchema = z.object({
  // Empty text is allowed through the schema so the service can answer with a
  // structured { ok: false } result instead of a thrown payload error.
  text: z.string().max(MAX_TRANSCRIPT_CHARS, `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`),
  cwd: z.string().max(MAX_CWD_CHARS).optional()
})

export interface PromptIpcDeps {
  prompts: PromptService
  activity: ActivityLog
}

export function registerPromptIpc(deps: PromptIpcDeps): void {
  ipcMain.handle(IPC.promptsStatus, () => deps.prompts.statuses())

  ipcMain.handle(IPC.promptsTest, async (_event, payload: unknown) => {
    const { id } = parseOrThrow(promptsTestSchema, payload)
    const status = await deps.prompts.test(id)
    const reached = status.reachable
    deps.activity.record({
      category: 'voice',
      type: 'prompts.test',
      message: `Prompt provider "${id}" ${reached ? 'responded' : 'failed a connectivity test'} (${status.ms ?? 0} ms)`,
      level: reached ? 'success' : 'warn',
      details: {
        provider: id,
        reachable: reached,
        configured: status.configured,
        model: status.model,
        ms: status.ms
      }
    })
    return status
  })

  ipcMain.handle(IPC.promptsEnhance, async (_event, payload: unknown) => {
    const parsed = parseOrThrow(promptsEnhanceSchema, payload)
    const result = await deps.prompts.enhance({ text: parsed.text, cwd: parsed.cwd })
    // Metadata only: never the transcript, never provider message bodies.
    deps.activity.record({
      category: 'voice',
      type: 'prompts.enhanced',
      message: result.ok
        ? `Prompt enhanced with "${result.provider}" (${result.ms} ms)`
        : `Prompt enhancement failed${result.blocked ? ' (blocked by local-only mode)' : ''}`,
      level: result.ok ? 'success' : 'warn',
      details: {
        ok: result.ok,
        provider: result.provider,
        ms: result.ms,
        sourceChars: result.original.length,
        enhancedChars: result.enhanced.length,
        attempts: result.attempts.length,
        usedProjectContext: result.usedProjectContext
      }
    })
    return result
  })
}
