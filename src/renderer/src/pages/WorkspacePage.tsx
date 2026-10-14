import { useMemo, type ReactNode } from 'react'
import {
  Activity as ActivityIcon,
  Boxes,
  CircleCheck,
  CircleDashed,
  Cpu,
  Play,
  Plus,
  RefreshCw,
  SquareTerminal,
  Users
} from 'lucide-react'
import type { ActivityEvent, AgentProfileStatus } from '@shared/types'
import { useApp } from '../state/store'
import { EmptyState, Pill } from '../components/primitives'
import { Tooltip } from '../components/Tooltip'
import { agentIcon } from '../lib/icons'
import { formatRelative, shortenPath } from '../lib/format'
import { terminalRegistry } from '../features/terminals/registry'

function levelTone(level: ActivityEvent['level']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (level === 'success') return 'success'
  if (level === 'warn') return 'warning'
  if (level === 'error') return 'danger'
  return 'neutral'
}

export function WorkspacePage(): ReactNode {
  const { state, actions } = useApp()
  const { sessions, external, agents, system, activity } = state

  const running = useMemo(() => sessions.filter((session) => session.status === 'running').length, [sessions])
  const availableAgents = useMemo(() => agents.filter((agent) => agent.available).length, [agents])
  const recentActivity = useMemo(() => [...activity].slice(-6).reverse(), [activity])

  const launchAgent = async (agent: AgentProfileStatus): Promise<void> => {
    if (!agent.available) {
      actions.toast(`${agent.name} was not found on PATH.`, 'error')
      return
    }
    const session = await actions.createTerminal({ title: agent.name })
    if (!session) return
    const command = [agent.command, ...agent.args].join(' ').trim()
    terminalRegistry.queueCommand(session.id, command)
    actions.navigate('terminals')
    actions.toast(`Launching ${agent.name} in a new shell.`, 'info')
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Workspace</h1>
          <p className="page__subtitle">Live overview of terminals, integrations and coding agents.</p>
        </div>
        <div className="page__actions">
          <button className="btn" onClick={() => void actions.refreshExternal()}>
            <RefreshCw size={14} className={state.externalRefreshing ? 'spin' : undefined} />
            Rescan
          </button>
          <button className="btn btn--primary" onClick={() => void actions.createTerminal()}>
            <Plus size={15} />
            New terminal
          </button>
        </div>
      </header>

      <div className="page__body stack">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat__label">Running sessions</span>
            <span className="stat__value">{running}</span>
            <span className="stat__meta">{sessions.length} total tabs</span>
          </div>
          <div className="stat">
            <span className="stat__label">External sessions</span>
            <span className="stat__value">{external.length}</span>
            <span className="stat__meta">
              {external.filter((session) => session.state === 'connected').length} connected
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Coding agents</span>
            <span className="stat__value">{availableAgents}</span>
            <span className="stat__meta">{agents.length} configured profiles</span>
          </div>
          <div className="stat">
            <span className="stat__label">Terminal backend</span>
            <span className="stat__value">{system?.terminalBackend.nodePty ? 'Ready' : 'Unavailable'}</span>
            <span className="stat__meta">
              node-pty {system?.terminalBackend.ptyVersion ?? '—'}
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Coding agents</span>
            <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              Launched as ordinary CLI programs inside a real shell
            </span>
          </div>
          {agents.length === 0 ? (
            <div className="panel__body">
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                No agent profiles configured yet.
              </p>
            </div>
          ) : (
            <ul className="list">
              {agents.map((agent) => {
                const Icon = agentIcon(agent.icon)
                return (
                  <li className="list__row" key={agent.id}>
                    <span className="activity-icon">
                      <Icon size={15} />
                    </span>
                    <div className="grow">
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="list__primary">{agent.name}</span>
                        {agent.available ? (
                          <Pill tone="success">
                            <CircleCheck size={11} />
                            available
                          </Pill>
                        ) : (
                          <Pill tone="neutral">
                            <CircleDashed size={11} />
                            not found
                          </Pill>
                        )}
                        {agent.kind === 'custom' ? <Pill>custom</Pill> : null}
                      </div>
                      <div className="list__secondary mono">
                        {agent.command}
                        {agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
                        {agent.version ? ` · ${agent.version}` : ''}
                      </div>
                      {agent.description ? <div className="list__secondary">{agent.description}</div> : null}
                    </div>
                    <Tooltip
                      label={agent.available ? `Launch ${agent.name}` : `${agent.name} is not installed`}
                      placement="bottom"
                    >
                      <button
                        className="btn btn--sm"
                        disabled={!agent.available}
                        onClick={() => void launchAgent(agent)}
                      >
                        <Play size={13} />
                        Launch
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="row" style={{ alignItems: 'stretch', gap: 'var(--space-4)' }}>
          <div className="panel grow">
            <div className="panel__header">
              <span className="panel__title">System</span>
              <Cpu size={15} className="muted" />
            </div>
            <div className="panel__body">
              {system ? (
                <div className="kv">
                  <span className="kv__key">VoxTerm</span>
                  <span className="kv__value">{system.appVersion}</span>
                  <span className="kv__key">Electron / Chrome</span>
                  <span className="kv__value">
                    {system.electron} / {system.chrome}
                  </span>
                  <span className="kv__key">Node</span>
                  <span className="kv__value">{system.node}</span>
                  <span className="kv__key">Platform</span>
                  <span className="kv__value">
                    {system.platform} · {system.arch} · {system.osRelease}
                  </span>
                  <span className="kv__key">Host</span>
                  <span className="kv__value">{system.hostname}</span>
                  <span className="kv__key">Default shell</span>
                  <span className="kv__value">{shortenPath(system.defaultShell) || system.defaultShell}</span>
                  <span className="kv__key">tmux / screen</span>
                  <span className="kv__value">
                    {system.tmux.available ? system.tmux.version ?? 'available' : 'not installed'} ·{' '}
                    {system.screen.available ? system.screen.version ?? 'available' : 'not installed'}
                  </span>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Gathering system information…
                </p>
              )}
            </div>
          </div>

          <div className="panel grow">
            <div className="panel__header">
              <span className="panel__title">Recent activity</span>
              <Tooltip label="Open activity log" placement="bottom">
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label="Open activity log"
                  onClick={() => actions.navigate('activity')}
                >
                  <ActivityIcon size={14} />
                </button>
              </Tooltip>
            </div>
            {recentActivity.length === 0 ? (
              <div className="panel__body">
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  No events recorded yet.
                </p>
              </div>
            ) : (
              <ul className="list">
                {recentActivity.map((event) => (
                  <li className="list__row" key={event.id}>
                    <Pill tone={levelTone(event.level)}>{event.category}</Pill>
                    <div className="grow">
                      <div className="list__primary truncate">{event.message}</div>
                    </div>
                    <span className="list__time">{formatRelative(event.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Detected tooling</span>
            <Boxes size={15} className="muted" />
          </div>
          <div className="panel__body">
            {system ? (
              <div className="chip-row">
                {system.shells.map((tool) => (
                  <span className={tool.available ? 'chip chip--active' : 'chip'} key={`shell-${tool.name}`}>
                    <SquareTerminal size={12} />
                    {tool.name}
                  </span>
                ))}
                <span className={system.tmux.available ? 'chip chip--active' : 'chip'}>tmux</span>
                <span className={system.screen.available ? 'chip chip--active' : 'chip'}>screen</span>
                {system.agents.map((tool) => (
                  <span className={tool.available ? 'chip chip--active' : 'chip'} key={`agent-${tool.name}`}>
                    <Users size={12} />
                    {tool.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {!system ? (
          <EmptyState
            icon={<Cpu size={24} />}
            title="Loading workspace"
            text="Reading system information and discovering available tooling."
          />
        ) : null}
      </div>
    </div>
  )
}
