import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { TerminalSessionInfo } from '@shared/types'
import { StatusDot } from '../../components/primitives'
import { ContextMenu, type MenuEntry } from '../../components/ContextMenu'
import { Tooltip } from '../../components/Tooltip'

interface TerminalTabsProps {
  sessions: TerminalSessionInfo[]
  activeId: string | null
  onSelect: (id: string) => void
  /** Request closing a session; the page resolves the confirmation policy. */
  onRequestClose: (session: TerminalSessionInfo) => void
  onRename: (id: string, title: string) => void
  onCreate: () => void
}

function dotState(session: TerminalSessionInfo): 'running' | 'starting' | 'exited' {
  if (session.status === 'starting') return 'starting'
  if (session.status === 'running') return 'running'
  return 'exited'
}

/**
 * Horizontal session tabs. Tabs are keyed by stable session id, never by
 * position, so reordering or closing a neighbour never disturbs a running
 * shell. Each tab exposes selection, inline rename and close.
 */
export function TerminalTabs({
  sessions,
  activeId,
  onSelect,
  onRequestClose,
  onRename,
  onCreate
}: TerminalTabsProps): ReactNode {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; session: TerminalSessionInfo } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  // Keep the active tab in view when sessions are added or switched.
  useEffect(() => {
    if (!activeId) return
    tabRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, sessions.length])

  const moveSelection = (from: string, delta: number): void => {
    if (sessions.length < 2) return
    const index = sessions.findIndex((session) => session.id === from)
    const next = sessions[(index + delta + sessions.length) % sessions.length]
    if (!next) return
    onSelect(next.id)
    requestAnimationFrame(() => tabRefs.current.get(next.id)?.focus())
  }

  const commitRename = (): void => {
    if (!renaming) return
    const value = renaming.value.trim()
    if (value) onRename(renaming.id, value)
    setRenaming(null)
  }

  const menuEntries = (session: TerminalSessionInfo): MenuEntry[] => [
    {
      id: 'rename',
      label: 'Rename tab',
      onSelect: () => setRenaming({ id: session.id, value: session.title })
    },
    {
      id: 'copy-cwd',
      label: 'Copy working directory',
      onSelect: () => void window.voxterm.clipboard.writeText(session.cwd)
    },
    { id: 'sep-1', type: 'separator' },
    {
      id: 'close',
      label: session.status === 'running' ? 'Terminate session' : 'Close tab',
      danger: session.status === 'running',
      onSelect: () => onRequestClose(session)
    }
  ]

  return (
    <div className="tabs">
      <div className="tabs__scroll" role="tablist" aria-label="Terminal sessions">
        {sessions.map((session) => {
          const isActive = session.id === activeId
          return (
            <div
              key={session.id}
              ref={(node) => {
                if (node) tabRefs.current.set(session.id, node)
                else tabRefs.current.delete(session.id)
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={isActive ? 'tab tab--active' : 'tab'}
              title={`${session.title} — ${session.shellName}`}
              onClick={() => onSelect(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(session.id)
                  return
                }
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  moveSelection(session.id, event.key === 'ArrowRight' ? 1 : -1)
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  onRequestClose(session)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, session })
              }}
            >
              <StatusDot state={dotState(session)} title={session.status} />
              {renaming?.id === session.id ? (
                <input
                  ref={inputRef}
                  className="tab__input"
                  value={renaming.value}
                  onChange={(event) => setRenaming({ id: session.id, value: event.target.value })}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <span className="tab__title">{session.title}</span>
              )}
              <button
                type="button"
                className="tab__close"
                aria-label={`Close ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onRequestClose(session)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <Tooltip label="New terminal (Ctrl+Shift+T)" placement="bottom">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm tabs__new"
          aria-label="New terminal"
          onClick={onCreate}
        >
          <Plus size={15} />
        </button>
      </Tooltip>
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} entries={menuEntries(menu.session)} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  )
}
