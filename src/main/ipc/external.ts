import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Services } from '../services'
import { parseOrThrow } from './util'
import { externalIdSchema } from './schemas'

export function registerExternalIpc(services: Services): void {
  ipcMain.handle(IPC.externalListProviders, () => services.external.getProviders())
  ipcMain.handle(IPC.externalList, () => services.external.list())
  ipcMain.handle(IPC.externalRefresh, () => services.external.refresh())

  ipcMain.handle(IPC.externalAttach, async (_event, id: unknown) => {
    const valid = parseOrThrow(externalIdSchema, id)
    const result = await services.external.attach(valid)
    services.activity.record({
      category: 'external',
      type: result.ok ? 'external.attached' : 'external.attach-failed',
      message: result.ok
        ? `Attached to external session ${valid}`
        : `Failed to attach to ${valid}: ${result.message ?? 'unknown error'}`,
      level: result.ok ? 'success' : 'error',
      details: { sessionId: valid, state: result.state }
    })
    return result
  })

  ipcMain.handle(IPC.externalDetach, async (_event, id: unknown) => {
    const valid = parseOrThrow(externalIdSchema, id)
    const result = await services.external.detach(valid)
    services.activity.record({
      category: 'external',
      type: result.ok ? 'external.detached' : 'external.detach-failed',
      message: result.ok ? `Detached from ${valid}` : `Detach failed for ${valid}`,
      level: result.ok ? 'info' : 'error'
    })
    return result
  })

  ipcMain.handle(IPC.externalTerminate, async (_event, id: unknown) => {
    const valid = parseOrThrow(externalIdSchema, id)
    const result = await services.external.terminate(valid)
    services.activity.record({
      category: 'external',
      type: result.ok ? 'external.terminated' : 'external.terminate-failed',
      message: result.ok ? `Terminated external session ${valid}` : `Terminate failed for ${valid}`,
      level: result.ok ? 'warn' : 'error'
    })
    return result
  })

  ipcMain.handle(IPC.externalStatus, async (_event, id: unknown) => {
    const valid = parseOrThrow(externalIdSchema, id)
    return services.external.status(valid)
  })
}
