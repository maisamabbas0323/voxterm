import type { LucideIcon } from 'lucide-react'
import { Activity, LayoutDashboard, Settings2, SquareTerminal } from 'lucide-react'

export type NavKey = 'workspace' | 'terminals' | 'activity' | 'settings'

export interface NavItem {
  key: NavKey
  label: string
  icon: LucideIcon
  description: string
  /** `footer` items are pinned to the bottom of the rail, away from daily views. */
  group: 'primary' | 'footer'
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'workspace', label: 'Workspace', icon: LayoutDashboard, group: 'primary', description: 'Overview of terminals, agents and system' },
  { key: 'terminals', label: 'Terminals', icon: SquareTerminal, group: 'primary', description: 'Real shell sessions and tabs' },
  { key: 'activity', label: 'Activity', icon: Activity, group: 'primary', description: 'History of application events' },
  { key: 'settings', label: 'Settings', icon: Settings2, group: 'footer', description: 'Configure VoxTerm' }
]
