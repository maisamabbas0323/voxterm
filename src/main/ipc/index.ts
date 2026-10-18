import { IPC_EVENTS } from '@shared/ipc'
import type { ActivityEvent } from '@shared/types'
import { broadcast, type Services } from '../services'
import { registerSettingsIpc } from './settings'
import { registerSystemIpc } from './system'
import { registerWindowIpc } from './window'
import { registerTerminalIpc } from './terminal'
import { registerAgentIpc } from './agents'
import { registerVoiceIpc } from './voice'
import { registerExternalIpc } from './external'
import { registerAnnouncementIpc } from './announcements'
import { registerPromptIpc } from './prompts'
import { registerActivityIpc, registerAppIpc } from './activity'

/** Register every request handler. Called once during app startup. */
export function registerIpcHandlers(services: Services): void {
  registerSettingsIpc(services)
  registerSystemIpc(services)
  registerWindowIpc(services)
  registerTerminalIpc(services)
  registerAgentIpc(services)
  registerVoiceIpc(services)
  registerExternalIpc({ external: services.external, activity: services.activity })
  registerAnnouncementIpc({ announcements: services.announcements })
  registerPromptIpc({ prompts: services.prompts, activity: services.activity })
  registerActivityIpc(services)
  registerAppIpc(services)
}

/**
 * Decide which genuinely-observed activity is worth speaking aloud.
 *
 * Every map here is a real event that VoxTerm itself caused — an exited shell,
 * a failed operation, an agent profile change. Nothing is inferred, and the
 * announcement service's own activity records are skipped so a failed
 * synthesis can never feed back into another announcement.
 */
async function announceActivity(services: Services, event: ActivityEvent): Promise<void> {
  if (event.type.startsWith('announcement.')) return

  const category = event.type.startsWith('agent.')
    ? 'agent-event'
    : event.level === 'error'
      ? 'error'
      : null
  if (!category) return

  // The service applies the settings gates (enabled, muted, category, dedupe).
  await services.announcements.announce(category, event.message)
}

/**
 * Forward main-process events to the renderer and record genuine activity.
 */
export function wireMainEvents(services: Services): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    services.sessions.on('data', (payload) => broadcast(IPC_EVENTS.terminalData, payload)),
    services.sessions.on('title', (payload) => broadcast(IPC_EVENTS.terminalTitle, payload)),
    services.sessions.on('session', (payload) => broadcast(IPC_EVENTS.terminalSessionChanged, payload)),
    services.sessions.on('list', (payload) => broadcast(IPC_EVENTS.terminalListChanged, payload)),
    services.sessions.on('exit', (payload) => {
      broadcast(IPC_EVENTS.terminalExit, payload)
      const info = services.sessions.get(payload.sessionId)
      services.activity.record({
        category: 'terminal',
        type: 'terminal.exited',
        message: `Session "${info?.title ?? payload.sessionId}" exited (code ${payload.exitCode ?? 'n/a'})`,
        level: payload.exitCode === 0 ? 'info' : 'warn',
        details: { sessionId: payload.sessionId, exitCode: payload.exitCode, signal: payload.signal }
      })
      // An attached multiplexer session outlives our client — closing the tab
      // only detaches us, so announcing a "session exit" would be a lie.
      if (info && !info.origin.detachOnly) {
        void services.announcements
          .announce('session-exit', `Terminal ${info.title} exited.`)
          .catch(() => undefined)
      }
    }),
    services.activity.onEvent((event) => {
      broadcast(IPC_EVENTS.activityEvent, event)
      void announceActivity(services, event).catch(() => undefined)
    })
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
