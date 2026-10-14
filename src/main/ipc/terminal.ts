import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { CloseSessionResult, TerminalSessionInfo } from '@shared/types'
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
 * Close a terminal session. Closing a tab and terminating its process are the
 * same operation for a VoxTerm-managed shell: the process group is terminated
 * so nothing is left orphaned, then the tab disappears.
 */
async function closeSession(services: Services, sessionId: string): Promise<CloseSessionResult> {
  const info = services.sessions.get(sessionId)
  if (!info) {
    return { id: sessionId, terminated: false, message: 'Session already closed.' }
  }

  await services.sessions.terminate(sessionId)
  services.activity.record({
    category: 'terminal',
    type: 'terminal.closed',
    message: `Closed terminal "${info.title}"`,
    level: 'info',
    details: { sessionId, shell: info.shellName }
  })
  return { id: sessionId, terminated: true }
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
    const sessionId = parseOrThrow(terminalCloseSchema, payload)
    return closeSession(services, sessionId)
  })
}

export type { TerminalSessionInfo }
