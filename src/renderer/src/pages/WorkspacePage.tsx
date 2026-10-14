import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity as ActivityIcon,
  Check,
  Copy,
  Cpu,
  Play,
  Plus,
  RefreshCw,
  Users
} from 'lucide-react'
import type { AgentProfileStatus, ToolAvailability } from '@shared/types'
import { useApp } from '../state/store'
import { Tooltip } from '../components/Tooltip'
import { agentIcon } from '../lib/icons'
import { formatRelative, shortenPath } from '../lib/format'
import { terminalRegistry } from '../features/terminals/registry'
import { useCountUp } from '../lib/useCountUp'
import { groupDetectedTooling, mergeActivityRepeats, systemInfoToText } from '../lib/workspace'

/** Animates the running-session count; jumps when motion is reduced. */
function CountedSessions({ running }: { running: number }): ReactNode {
  const value = useCountUp(running)
  return <>{value}</>
}

/** Five thin segments; filled ones correspond to discovered agents. */
function AgentBar({ filled, total }: { filled: number; total: number }): ReactNode {
  const slots = Math.max(total, 1)
  return (
    <span className="statbar" role="img" aria-label={`${filled} of ${slots} found`}>
      {Array.from({ length: slots }, (_, index) => (
        <span key={index} className={index < filled ? 'statbar__seg statbar__seg--on' : 'statbar__seg'} />
      ))}
    </span>
  )
}

function StatShell({
  icon,
  label,
  children
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="stat stat--card">
      <div className="stat__head">
        <span className="stat__iconsq" aria-hidden="true">
          {icon}
        </span>
        <span className="stat__label">{label}</span>
      </div>
      {children}
    </div>
  )
}

export function WorkspacePage(): ReactNode {
  const { state, actions } = useApp()
  const { sessions, agents, system, activity } = state
  const [refreshing, setRefreshing] = useState(false)

  const running = useMemo(() => sessions.filter((session) => session.status === 'running').length, [sessions])
  const availableAgents = useMemo(() => agents.filter((agent) => agent.available).length, [agents])
  const recentRows = useMemo(
    () => mergeActivityRepeats(activity).slice(-5).reverse(),
    [activity]
  )
  const toolGroups = useMemo(() => (system ? groupDetectedTooling(system) : []), [system])

  const launchAgent = async (agent: AgentProfileStatus): Promise<void> => {
    if (!agent.available) return
    const session = await actions.createTerminal({ title: agent.name })
    if (!session) return
    const command = [agent.command, ...agent.args].join(' ').trim()
    terminalRegistry.queueCommand(session.id, command)
    actions.navigate('terminals')
    actions.toast(`Launching ${agent.name} in a new shell.`, 'info')
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all([actions.refreshSystem(), actions.refreshAgents(), actions.refreshSessions()])
    } finally {
      setRefreshing(false)
    }
  }

  const copySystem = async (): Promise<void> => {
    if (!system) return
    await window.voxterm.clipboard.writeText(systemInfoToText(system))
    actions.toast('System info copied as plain text.', 'success')
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Workspace</h1>
          <p className="page__subtitle">Your terminals, coding agents and machine at a glance.</p>
        </div>
        <div className="page__actions">
          <Tooltip label="Refresh" placement="bottom">
            <button className="btn btn--icon" aria-label="Refresh workspace" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
          <button className="btn btn--primary" onClick={() => void actions.createTerminal()}>
            <Plus size={16} strokeWidth={1.5} />
            New terminal
          </button>
        </div>
      </header>

      <div className="page__body stack">
        {/* Stat cards */}
        <div className="stat-grid">
          <StatShell icon={<Cpu size={16} strokeWidth={1.5} />} label="Running sessions">
            <span className="stat__value">
              <CountedSessions running={running} />
            </span>
            <span className="row stat__dots" aria-hidden="true">
              {sessions.slice(0, 5).map((session) => (
                <span
                  key={session.id}
                  className={`dot dot--small ${
                    session.status === 'running'
                      ? 'dot--running'
                      : session.status === 'starting'
                        ? 'dot--starting'
                        : 'dot--exited'
                  }`}
                />
              ))}
              {sessions.length > 5 ? <span className="stat__plus">+{sessions.length - 5}</span> : null}
            </span>
            <button className="stat__link" onClick={() => actions.navigate('terminals')}>
              {sessions.length === 0 ? 'No tabs open' : 'Open terminals'}
            </button>
          </StatShell>

          <StatShell icon={<Users size={16} strokeWidth={1.5} />} label="Coding agents">
            <span className="stat__value">
              {availableAgents} / {agents.length}
            </span>
            <AgentBar filled={availableAgents} total={agents.length} />
            <span className="stat__meta">
              {availableAgents === agents.length
                ? 'All ready on this machine'
                : `${availableAgents} of ${agents.length} ready on this machine`}
            </span>
          </StatShell>

          <StatShell icon={<Cpu size={16} strokeWidth={1.5} />} label="Terminal backend">
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <span
                className={`dot ${
                  system?.terminalBackend.nodePty
                    ? 'dot--running dot--pulse'
                    : 'dot--alert'
                }`}
                aria-hidden="true"
              />
              <span className="stat__value">
                {system?.terminalBackend.nodePty ? 'Ready' : system ? 'Unavailable' : '…'}
              </span>
            </span>
            <span className="stat__meta mono">
              {system?.terminalBackend.nodePty
                ? `node-pty ${system.terminalBackend.ptyVersion ?? ''}`.trimEnd()
                : (system?.terminalBackend.error ?? 'checking…')}
            </span>
          </StatShell>
        </div>

        {/* Coding agents: equal cards in one responsive row. */}
        <section className="panel">
          <div className="panel__header">
            <div className="col">
              <span className="panel__title">Coding agents</span>
              <span className="panel__caption">Typed into a real shell, never hidden from you.</span>
            </div>
            <Users size={16} strokeWidth={1.5} className="muted" />
          </div>
          {agents.length === 0 ? (
            <div className="panel__body">
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                No agent profiles yet. Add one by typing its command in a terminal.
              </p>
            </div>
          ) : refreshing ? (
            <div className="agent-grid">
              {agents.map((agent) => (
                <div className="agent-card agent-card--ghost" key={`sk-${agent.id}`} aria-hidden="true">
                  <Skeleton lines={3} />
                </div>
              ))}
            </div>
          ) : (
            <div className="agent-grid">
              {agents.map((agent) => {
                const Icon = agentIcon(agent.icon)
                return (
                  <div
                    className={agent.available ? 'agent-card' : 'agent-card agent-card--missing'}
                    key={agent.id}
                  >
                    <div className="agent-card__top">
                      <span className="stat__iconsq" aria-hidden="true">
                        <Icon size={16} strokeWidth={1.5} />
                      </span>
                      <span
                        className={`dot dot--small ${agent.available ? 'dot--running' : 'dot--exited'}`}
                        aria-hidden="true"
                      />
                    </div>
                    <span className="agent-card__name truncate">{agent.name}</span>
                    {agent.version ? (
                      <Tooltip label={agent.version} placement="top">
                        <span className="agent-card__version mono truncate">{agent.version}</span>
                      </Tooltip>
                    ) : agent.available ? null : (
                      <Tooltip label={`${agent.command} is not on PATH`} placement="top">
                        <span className="agent-card__version mono truncate">Not installed</span>
                      </Tooltip>
                    )}
                    <button
                      className="btn btn--sm agent-card__launch"
                      disabled={!agent.available}
                      onClick={() => void launchAgent(agent)}
                    >
                      <Play size={16} strokeWidth={1.5} />
                      {agent.available ? 'Launch' : 'Not installed'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="split">
          {/* System */}
          <section className="panel">
            <div className="panel__header">
              <span className="panel__title">System</span>
              <Tooltip label="Copy system info" placement="bottom">
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label="Copy system info as text"
                  onClick={() => void copySystem()}
                  disabled={!system}
                >
                  <Copy size={16} strokeWidth={1.5} />
                </button>
              </Tooltip>
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
                  <Tooltip label={system.osRelease} placement="top">
                    <span className="kv__value truncate">{`${system.platform} · ${system.arch}`}</span>
                  </Tooltip>
                  <span className="kv__key">Host</span>
                  <Tooltip label={system.hostname} placement="top">
                    <span className="kv__value truncate">{system.hostname}</span>
                  </Tooltip>
                  <span className="kv__key">Default shell</span>
                  <Tooltip label={system.defaultShell} placement="top">
                    <span className="kv__value truncate">
                      {shortenPath(system.defaultShell) || system.defaultShell}
                    </span>
                  </Tooltip>
                </div>
              ) : refreshing ? (
                <Skeleton lines={6} />
              ) : (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Gathering system info…
                </p>
              )}
            </div>
          </section>

          {/* Recent activity */}
          <section className="panel">
            <div className="panel__header">
              <span className="panel__title">Recent activity</span>
              <button className="stat__link" onClick={() => actions.navigate('activity')}>
                View all
              </button>
            </div>
            {recentRows.length === 0 ? (
              <div className="panel__body">
                <div className="empty empty--inline">
                  <div className="empty__icon">
                    <ActivityIcon size={22} strokeWidth={1.5} />
                  </div>
                  <p className="empty__text">Nothing yet. Open a terminal to get started.</p>
                </div>
              </div>
            ) : (
              <ul className="list">
                {recentRows.map((row) => {
                  const count = row.count > 1 ? row.count : undefined
                  return (
                    <li className="list__row list__row--tight" key={row.id}>
                      <span
                        className={`dot dot--small list__leveldot ${
                          row.level === 'success'
                            ? 'dot--running'
                            : row.level === 'warn'
                              ? 'dot--warn'
                              : row.level === 'error'
                                ? 'dot--alert'
                                : 'dot--exited'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="grow" style={{ minWidth: 90 }}>
                        <div className="row" style={{ gap: 'var(--space-2)' }}>
                          <span className="list__primary truncate">{row.message}</span>
                          {count ? <span className="list__count">x{count}</span> : null}
                          <span className="chip chip--mini">{row.category}</span>
                        </div>
                      </div>
                      <span className="list__time" title={new Date(row.timestamp).toLocaleString()}>
                        {formatRelative(row.timestamp)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Detected tooling */}
        <section className="panel workspace__tooling">
          <div className="panel__header">
            <div className="col">
              <span className="panel__title">Detected tooling</span>
              <span className="panel__caption">What VoxTerm found on your PATH.</span>
            </div>
          </div>
          <div className="panel__body">
            {system ? (
              <div className="tool-groups">
                {toolGroups.map((group) => {
                  const found = group.items.filter((tool) => tool.available).length
                  return (
                    <div className="tool-group" key={group.label}>
                      <span className="tool-group__label">
                        {group.label} <span className="tool-group__count">{found}/{group.items.length}</span>
                      </span>
                      <div className="chip-row">
                        {group.items.map((tool) => (
                          <ToolChip key={tool.name} tool={tool} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : refreshing ? (
              <Skeleton lines={3} />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function ToolChip({ tool }: { tool: ToolAvailability }): ReactNode {
  const body = (
    <span className={tool.available ? 'chip chip--found' : 'chip chip--missing'} title={tool.path ?? tool.name}>
      {tool.available ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
      {tool.name}
    </span>
  )
  if (tool.available) return body
  return (
    <Tooltip label={`${tool.name} not on PATH`} placement="top">
      {body}
    </Tooltip>
  )
}

/** Quiet skeleton placeholder — shimmer only when motion is allowed. */
export function Skeleton({ lines = 3 }: { lines?: number }): ReactNode {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="skeleton__line"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  )
}
