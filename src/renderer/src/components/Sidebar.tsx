import type { ReactNode } from 'react'
import { NAV_ITEMS, type NavItem, type NavKey } from './nav'

interface SidebarProps {
  active: NavKey
  onNavigate: (key: NavKey) => void
}

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.group === 'primary')
const FOOTER_ITEMS = NAV_ITEMS.filter((item) => item.group === 'footer')

/**
 * Permanent icon rail. The sidebar neither collapses nor expands: the sections
 * are always one click away at a fixed width, and Settings is pinned to the
 * bottom, separated from daily views. Every button carries an accessible name,
 * so the rail stays legible to assistive technology without hover tooltips.
 */
export function Sidebar({ active, onNavigate }: SidebarProps): ReactNode {
  const renderItem = (item: NavItem): ReactNode => {
    const Icon = item.icon
    const isActive = item.key === active
    return (
      <button
        key={item.key}
        type="button"
        className={isActive ? 'nav-item nav-item--active' : 'nav-item'}
        aria-current={isActive ? 'page' : undefined}
        aria-label={item.label}
        onClick={() => onNavigate(item.key)}
      >
        <span className="nav-item__icon">
          <Icon size={19} strokeWidth={1.8} />
        </span>
      </button>
    )
  }

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <span className="sidebar__sheen" aria-hidden="true" />
      <nav className="sidebar__nav" aria-label="Sections">
        {PRIMARY_ITEMS.map(renderItem)}
      </nav>
      <div className="sidebar__footer">{FOOTER_ITEMS.map(renderItem)}</div>
    </aside>
  )
}
