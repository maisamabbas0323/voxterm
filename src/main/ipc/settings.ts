import { ipcMain } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import { broadcast, type Services } from '../services'
import { parseOrThrow } from './util'
import { settingsSecretClearSchema, settingsSecretSchema } from './schemas'

export function registerSettingsIpc(services: Services): void {
  ipcMain.handle(IPC.settingsGet, () => services.settings.get())

  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => {
    const changedKeys =
      patch && typeof patch === 'object' && !Array.isArray(patch) ? Object.keys(patch as object) : []
    const result = services.settings.update(patch)
    if (!result.ok) {
      throw new Error(result.error ?? 'Settings update rejected')
    }
    if (changedKeys.length > 0) {
      services.activity.record({
        category: 'settings',
        type: 'settings.updated',
        message: `Settings updated: ${changedKeys.join(', ')}`,
        level: 'info',
        details: { sections: changedKeys.join(', ') }
      })
    }
    broadcast(IPC_EVENTS.settingsChanged, result.settings)
    return result.settings
  })

  ipcMain.handle(IPC.settingsReset, () => {
    const settings = services.settings.reset()
    services.activity.record({
      category: 'settings',
      type: 'settings.reset',
      message: 'Settings restored to defaults',
      level: 'warn'
    })
    broadcast(IPC_EVENTS.settingsChanged, settings)
    return settings
  })

  ipcMain.handle(IPC.settingsSetSecret, (_event, payload: unknown) => {
    const { slot, value } = parseOrThrow(settingsSecretSchema, payload)
    const ok = services.settings.setSecret(slot, value)
    services.activity.record({
      category: 'settings',
      type: 'settings.secret-updated',
      message: `Credential slot "${slot}" ${value.trim() ? 'updated' : 'cleared'}`,
      level: 'info',
      details: { slot }
    })
    return { ok, message: ok ? undefined : 'Unknown credential slot.' }
  })

  ipcMain.handle(IPC.settingsClearSecret, (_event, payload: unknown) => {
    const { slot } = parseOrThrow(settingsSecretClearSchema, payload)
    const ok = services.settings.clearSecret(slot)
    return { ok }
  })

  ipcMain.handle(IPC.settingsSecretsStatus, () => services.settings.secretsStatus())
}
