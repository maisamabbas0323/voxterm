import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { CloseSessionMode, CloseSessionResult, TerminalSessionInfo } from '@shared/types'
import type { Services } from '../services'
import { parseOrThrow } from './util'
import {
  terminalCloseSchema,
  terminalCreateSchema,
  terminalInputSchema,
  terminalRenameSchema,
  terminalResizeSchema
} from './schemas'

const sessionIdSchema = z.string().uuid()

/**
 * Close semantics are explicit and never conflated:
 *  - managed session  -> the shell is genuinely terminated.
 *  - external session -> detach keeps the shared session alive; terminate ends
 *    it through the provider's real mechanism.
 */
async function closeSession(
  services: Services,
  sessionId: string,
  mode: CloseSessionMode
): Promise<CloseSessionResult> {
  const info = services.sessions.get(sessionId)
  if (!info) {
    return { id: sessionId, mode, terminated: false, detached: true, message: 'Session already closed.' }
  }

  if (info.origin === 'external' && info.providerId && info.externalSessionId) {
    const fullExternalId = `${info.providerId}:${info.externalSessionId}`
    if (mode === 'detach') {
      const result = await services.external.detach(fullExternalId)
      services.activity.record({
        category: 'external',
        type: 'external.detached',
        message: `Detached from ${info.title}`,
        level: 'info',
        details: { providerId: info.providerId, session: info.externalSessionId }
      })
      return {
        id: sessionId,
        mode,
        terminated: false,
        detached: result.ok,
        message: result.message
      }
    }
    const result = await services.external.terminate(fullExternalId)
    if (!result.ok) {
      // The shared session could not be ended through the provider; at minimum
      // remove VoxTerm's own client so the tab can close honestly.
      await services.sessions.terminate(sessionId, 'SIGHUP').catch(() => undefined)
      return {
        id: sessionId,
        mode,
        terminated: false,
        detached: true,
        message: result.message ?? 'Underlying session could not be terminated.'
      }
    }
    services.activity.record({
      category: 'external',
      type: 'external.terminated',
      message: `Terminated external session ${info.title}`,
      level: 'warn',
      details: { providerId: info.providerId, session: info.externalSessionId }
    })
    await services.sessions.terminate(sessionId, 'SIGHUP').catch(() => undefined)
    return { id: sessionId, mode, terminated: true, detached: false }
  }

  await services.sessions.terminate(sessionId)
  services.activity.record({
    category: 'terminal',
    type: mode === 'detach' ? 'terminal.closed' : 'terminal.terminated',
    message: `Terminated terminal "${info.title}"`,
    level: 'info',
    details: { sessionId, shell: info.shellName }
  })
  return { id: sessionId, mode, terminated: true, detached: false }
}

export function registerTerminalIpc(services: Services): void {
  ipcMain.handle(IPC.terminalCreate, async (_event, payload: unknown) => {
    const options = parseOrThrow(terminalCreateSchema, payload ?? {})
    const session = await services.sessions.create(options)
    services.activity.record({
      category: 'terminal',
      type: 'terminal.created',
      message: `Created terminal (${session.shellName})`,
      level: 'success',
      details: { sessionId: session.id, shell: session.shellName, cwd: session.cwd }
    })
    return session
  })

  ipcMain.handle(IPC.terminalList, () => services.sessions.list())

  ipcMain.handle(IPC.terminalSubscribe, (_event, id: unknown) => {
    return services.sessions.subscribe(parseOrThrow(sessionIdSchema, id))
  })

  ipcMain.handle(IPC.terminalSnapshot, (_event, id: unknown) => {
    return services.sessions.snapshot(parseOrThrow(sessionIdSchema, id))
  })

  ipcMain.handle(IPC.terminalInput, (_event, payload: unknown) => {
    const { sessionId, data } = parseOrThrow(terminalInputSchema, payload)
    const ok = services.sessions.write(sessionId, data)
    return { ok, message: ok ? undefined : 'Session is not running.' }
  })

  ipcMain.handle(IPC.terminalResize, (_event, payload: unknown) => {
    const { sessionId, cols, rows } = parseOrThrow(terminalResizeSchema, payload)
    const ok = services.sessions.resize(sessionId, cols, rows)
    return { ok }
  })

  ipcMain.handle(IPC.terminalRename, (_event, payload: unknown) => {
    const { sessionId, title } = parseOrThrow(terminalRenameSchema, payload)
    const ok = services.sessions.rename(sessionId, title)
    return { ok }
  })

  ipcMain.handle(IPC.terminalClose, async (_event, payload: unknown) => {
    const { sessionId, mode } = parseOrThrow(terminalCloseSchema, payload)
    return closeSession(services, sessionId, mode)
  })

  ipcMain.handle(IPC.terminalTerminate, async (_event, payload: unknown) => {
    const parsed = parseOrThrow(z.object({ sessionId: sessionIdSchema }), payload)
    return closeSession(services, parsed.sessionId, 'terminate')
  })
}

export type { TerminalSessionInfo }
