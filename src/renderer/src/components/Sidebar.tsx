import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { NAV_ITEMS, type NavKey } from './nav'
import { Tooltip } from './Tooltip'

interface SidebarProps {
  active: NavKey
  expanded: boolean
  onNavigate: (key: NavKey) => void
  onToggleExpanded: () => void
}

/**
 * Narrow, rounded vertical navigation. Icons are centred in compact mode and
 * paired with labels in expanded mode. Every item is a real button with an
 * accessible label and a tooltip.
 */
export function Sidebar({ active, expanded, onNavigate, onToggleExpanded }: SidebarProps): ReactNode {
  return (
    <aside className={expanded ? 'sidebar sidebar--expanded' : 'sidebar'} aria-label="Primary navigation">
      <nav className="sidebar__nav" aria-label="Sections">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.key === active
          return (
            <Tooltip key={item.key} label={expanded ? item.description : item.label} placement="bottom">
              <button
                type="button"
                className={isActive ? 'nav-item nav-item--active' : 'nav-item'}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                onClick={() => onNavigate(item.key)}
              >
                <span className="nav-item__icon">
                  <Icon size={18} strokeWidth={1.9} />
                </span>
                <span className="nav-item__label">{item.label}</span>
              </button>
            </Tooltip>
          )
        })}
      </nav>
      <div className="sidebar__footer">
        <Tooltip label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} placement="bottom">
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleExpanded}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
            {expanded ? <span>Collapse</span> : null}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
