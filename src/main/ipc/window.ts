import { ipcMain } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type { Services } from '../services'

export function registerWindowIpc(services: Services): void {
  ipcMain.handle(IPC.windowMinimize, () => {
    services.getWindow()?.minimize()
  })

  ipcMain.handle(IPC.windowMaximizeToggle, () => {
    const window = services.getWindow()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })

  ipcMain.handle(IPC.windowIsMaximized, () => services.getWindow()?.isMaximized() ?? false)

  ipcMain.handle(IPC.windowClose, () => {
    // Route through the graceful close flow so running sessions can be handled.
    services.requestAppClose()
  })

  void IPC_EVENTS
}
