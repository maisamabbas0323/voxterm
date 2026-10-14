import { IPC_EVENTS } from '@shared/ipc'
import { broadcast, type Services } from '../services'
import { registerSettingsIpc } from './settings'
import { registerSystemIpc } from './system'
import { registerWindowIpc } from './window'
import { registerTerminalIpc } from './terminal'
import { registerAgentIpc } from './agents'
import { registerActivityIpc, registerAppIpc } from './activity'

/** Register every request handler. Called once during app startup. */
export function registerIpcHandlers(services: Services): void {
  registerSettingsIpc(services)
  registerSystemIpc(services)
  registerWindowIpc(services)
  registerTerminalIpc(services)
  registerAgentIpc(services)
  registerActivityIpc(services)
  registerAppIpc(services)
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
    }),
    services.activity.onEvent((event) => broadcast(IPC_EVENTS.activityEvent, event))
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
