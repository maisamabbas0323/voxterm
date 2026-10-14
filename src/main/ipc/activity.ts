import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Services } from '../services'
import { parseOrThrow } from './util'
import { respondCloseSchema } from './schemas'

export function registerActivityIpc(services: Services): void {
  ipcMain.handle(IPC.activityList, () => services.activity.list())

  ipcMain.handle(IPC.activityClear, () => {
    services.activity.clear()
    services.activity.record({
      category: 'system',
      type: 'activity.cleared',
      message: 'Activity history cleared',
      level: 'warn'
    })
    return { ok: true }
  })
}

export function registerAppIpc(services: Services): void {
  ipcMain.handle(IPC.appRespondClose, (_event, payload: unknown) => {
    const { confirm } = parseOrThrow(respondCloseSchema, payload)
    services.respondToClose(confirm)
  })

  ipcMain.handle(IPC.appConfirmQuit, () => {
    services.requestAppClose()
  })
}
