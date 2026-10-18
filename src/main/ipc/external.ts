import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ExternalDiscoveryResult, ExternalSessionKind } from '@shared/types'
import type { ActivityLog } from '../activity/log'

export interface ExternalIpcDeps {
  external: { discover(): Promise<ExternalDiscoveryResult> }
  activity: ActivityLog
}

/**
 * Register the external multiplexer discovery handler. The activity entry
 * carries counts only — never session names or any other user content — and
 * an empty discovery records nothing to avoid spamming the feed.
 */
export function registerExternalIpc(deps: ExternalIpcDeps): void {
  ipcMain.handle(IPC.externalDiscover, async () => {
    const result = await deps.external.discover()
    recordDiscovery(deps.activity, result)
    return result
  })
}

function recordDiscovery(activity: ActivityLog, result: ExternalDiscoveryResult): void {
  const perKind: Record<ExternalSessionKind, number> = { tmux: 0, screen: 0 }
  let attachable = 0
  for (const discovery of result.results) {
    for (const session of discovery.sessions) {
      perKind[session.kind] += 1
      if (session.attachable) attachable += 1
    }
  }
  const total = perKind.tmux + perKind.screen
  // Finding nothing is the common case (no multiplexer running); logging it
  // on every refresh would only add noise.
  if (total === 0) return
  activity.record({
    category: 'system',
    type: 'external.discovered',
    message: `Discovered ${total} external session${total === 1 ? '' : 's'} (${perKind.tmux} tmux, ${perKind.screen} screen).`,
    level: 'info',
    details: { tmux: perKind.tmux, screen: perKind.screen, attachable }
  })
}
