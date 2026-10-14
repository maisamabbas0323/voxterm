import { clipboard, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { Services } from '../services'
import { buildSystemInfo } from '../system/info'
import { parseOrThrow } from './util'
import { clipboardWriteSchema, openExternalSchema, revealPathSchema } from './schemas'

export function registerSystemIpc(services: Services): void {
  ipcMain.handle(IPC.systemInfo, () =>
    buildSystemInfo({
      resolvePath: services.resolvePath,
      getSettings: () => services.settings.get(),
      getProviders: () => services.external.getProviders()
    })
  )

  ipcMain.handle(IPC.systemOpenExternal, async (_event, url: unknown) => {
    const valid = parseOrThrow(openExternalSchema, url)
    await shell.openExternal(valid)
    return { ok: true }
  })

  ipcMain.handle(IPC.systemShowItemInFolder, (_event, path: unknown) => {
    const valid = parseOrThrow(revealPathSchema, path)
    shell.showItemInFolder(valid)
    return { ok: true }
  })

  // Clipboard is routed through the main process so the sandboxed renderer
  // needs no direct clipboard privileges.
  ipcMain.handle(IPC.clipboardRead, () => clipboard.readText())
  ipcMain.handle(IPC.clipboardWrite, (_event, text: unknown) => {
    const valid = parseOrThrow(clipboardWriteSchema, text)
    clipboard.writeText(valid)
  })
}
