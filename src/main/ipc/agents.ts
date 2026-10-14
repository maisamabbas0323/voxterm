import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentProfileStatus } from '@shared/types'
import type { Services } from '../services'
import { detectAgentProfile, invalidateAgentCache } from '../agents/profiles'
import { parseOrThrow } from './util'
import { agentDeleteSchema, agentSaveSchema } from './schemas'

async function listStatuses(services: Services): Promise<AgentProfileStatus[]> {
  const pathValue = await services.resolvePath()
  const profiles = services.agents.all()
  return Promise.all(profiles.map((profile) => detectAgentProfile(profile, pathValue)))
}

export function registerAgentIpc(services: Services): void {
  ipcMain.handle(IPC.agentsList, () => listStatuses(services))

  ipcMain.handle(IPC.agentsSave, async (_event, payload: unknown) => {
    const input = parseOrThrow(agentSaveSchema, payload)
    const result = services.agents.save(input)
    if (!result.ok) {
      throw new Error(result.error ?? 'Invalid agent profile')
    }
    invalidateAgentCache()
    services.activity.record({
      category: 'agent',
      type: 'agent.saved',
      message: `Saved agent profile "${input.name}"`,
      level: 'info',
      details: { command: input.command }
    })
    return listStatuses(services)
  })

  ipcMain.handle(IPC.agentsDelete, async (_event, payload: unknown) => {
    const { id } = parseOrThrow(agentDeleteSchema, payload)
    const result = services.agents.delete(id)
    if (!result.ok) {
      throw new Error(result.error ?? 'Unable to delete agent profile')
    }
    invalidateAgentCache()
    services.activity.record({
      category: 'agent',
      type: 'agent.deleted',
      message: 'Deleted an agent profile',
      level: 'warn'
    })
    return listStatuses(services)
  })
}
