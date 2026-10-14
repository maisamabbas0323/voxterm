import type { LucideIcon } from 'lucide-react'
import { Activity, LayoutDashboard, Mic, Settings2, SquareTerminal } from 'lucide-react'

export type NavKey = 'workspace' | 'terminals' | 'voice' | 'activity' | 'settings'

export interface NavItem {
  key: NavKey
  label: string
  icon: LucideIcon
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'workspace', label: 'Workspace', icon: LayoutDashboard, description: 'Overview of terminals, agents and system' },
  { key: 'terminals', label: 'Terminals', icon: SquareTerminal, description: 'Real shell sessions and tabs' },
  { key: 'voice', label: 'Voice', icon: Mic, description: 'Speech input and spoken announcements' },
  { key: 'activity', label: 'Activity', icon: Activity, description: 'History of application events' },
  { key: 'settings', label: 'Settings', icon: Settings2, description: 'Configure VoxTerm' }
]
