import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  Info,
  Search,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import type { ActivityCategory, ActivityEvent } from '@shared/types'
import { useApp } from '../state/store'
import { EmptyState } from '../components/primitives'
import { Tooltip } from '../components/Tooltip'
import { formatDateTime, formatRelative } from '../lib/format'

const CATEGORIES: Array<{ key: ActivityCategory | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'agent', label: 'Agent' },
  { key: 'settings', label: 'Settings' },
  { key: 'voice', label: 'Voice' },
  { key: 'system', label: 'System' },
  { key: 'error', label: 'Errors' }
]

const LEVELS: Array<{ key: ActivityEvent['level'] | 'all'; label: string }> = [
  { key: 'all', label: 'Any' },
  { key: 'info', label: 'Info' },
  { key: 'success', label: 'Success' },
  { key: 'warn', label: 'Warnings' },
  { key: 'error', label: 'Errors' }
]

function EventIcon({ level }: { level: ActivityEvent['level'] }): ReactNode {
  if (level === 'success') return <CheckCircle2 size={14} />
  if (level === 'warn') return <TriangleAlert size={14} />
  if (level === 'error') return <AlertTriangle size={14} />
  return <Info size={14} />
}

export function ActivityPage(): ReactNode {
  const { state, actions } = useApp()
  const [filter, setFilter] = useState<ActivityCategory | 'all'>('all')
  const [level, setLevel] = useState<ActivityEvent['level'] | 'all'>('all')
  const [query, setQuery] = useState('')

  const filtered = filter !== 'all' || level !== 'all' || query.trim().length > 0

  const events = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = state.activity.filter((event) => {
      if (filter !== 'all' && event.category !== filter) return false
      if (level !== 'all' && event.level !== level) return false
      if (needle && !event.message.toLowerCase().includes(needle) && !event.type.toLowerCase().includes(needle)) {
        return false
      }
      return true
    })
    return [...list].reverse()
  }, [state.activity, filter, level, query])

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Activity</h1>
          <p className="page__subtitle">
            A durable log of application events. Terminal output and credentials are never recorded here.
          </p>
        </div>
        <div className="page__actions">
          <Tooltip label="Reload the log from disk" placement="bottom">
            <button className="btn" onClick={() => void actions.loadActivity()}>
              Reload
            </button>
          </Tooltip>
          <button
            className="btn btn--danger"
            disabled={state.activity.length === 0}
            onClick={() => void actions.clearActivity()}
          >
            <Trash2 size={14} />
            Clear log
          </button>
        </div>
      </header>

      <div className="page__body stack">
        <div className="activity-controls">
          <div className="activity-controls__row">
            <span className="section-title">Category</span>
            <div className="chip-row chip-row--scroll">
              {CATEGORIES.map((category) => (
                <button
                  key={category.key}
                  className={filter === category.key ? 'chip chip--active' : 'chip'}
                  aria-pressed={filter === category.key}
                  onClick={() => setFilter(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>

          <div className="activity-controls__row">
            <span className="section-title">Level</span>
            <div className="chip-row chip-row--scroll">
              {LEVELS.map((item) => (
                <button
                  key={item.key}
                  className={level === item.key ? 'chip chip--active' : 'chip'}
                  aria-pressed={level === item.key}
                  onClick={() => setLevel(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {filtered ? (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setFilter('all')
                  setLevel('all')
                  setQuery('')
                }}
              >
                <X size={13} />
                Reset filters
              </button>
            ) : null}
            <label className="activity-search">
              <Search size={14} className="muted" />
              <input
                className="activity-search__input"
                placeholder="Filter events…"
                aria-label="Filter activity events"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="panel">
          {events.length === 0 ? (
            <EmptyState
              icon={<ActivityIcon size={24} />}
              title="No events"
              text={
                query.trim()
                  ? 'No events match your filter.'
                  : filter === 'all'
                    ? 'VoxTerm has not recorded any activity yet.'
                    : `No events in the “${filter}” category.`
              }
            />
          ) : (
            <>
              <div className="panel__header">
                <span className="panel__caption">
                  {events.length} of {state.activity.length} event{state.activity.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="list">
                {events.map((event) => (
                  <li className="list__row" key={event.id}>
                    <span
                      className={`activity-icon activity-icon--${
                        event.level === 'warn' ? 'warn' : event.level
                      }`}
                    >
                      <EventIcon level={event.level} />
                    </span>
                    <div className="grow">
                      <div className="list__primary">
                        {event.message}
                        {event.count && event.count > 1 ? <span className="list__count">x{event.count}</span> : null}
                      </div>
                      <div className="list__secondary">
                        {event.category} · {event.type}
                        {event.details
                          ? ` · ${Object.entries(event.details)
                              .map(([key, value]) => `${key}=${String(value)}`)
                              .join(', ')}`
                          : ''}
                      </div>
                    </div>
                    <span className="list__time" title={formatDateTime(event.timestamp)}>
                      {formatRelative(event.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
