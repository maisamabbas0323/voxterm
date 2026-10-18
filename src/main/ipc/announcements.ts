import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AnnouncementService } from '../announcements/service'

/** Renderer-facing handlers for announcement status and the real synthesis test. */
export function registerAnnouncementIpc(deps: { announcements: AnnouncementService }): void {
  ipcMain.handle(IPC.announcementsStatus, () => deps.announcements.status())

  ipcMain.handle(IPC.announcementsTest, async () => {
    try {
      return await deps.announcements.test()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `Announcement test failed: ${detail.slice(0, 200)}` }
    }
  })
}
