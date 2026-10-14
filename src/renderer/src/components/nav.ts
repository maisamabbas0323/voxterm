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
  { key: 'workspace', label: 'Workspace', icon: LayoutDashboard, description: 'Overview of sessions and system' },
  { key: 'terminals', label: 'Terminals', icon: SquareTerminal, description: 'Managed and external terminal sessions' },
  { key: 'voice', label: 'Voice', icon: Mic, description: 'Voice workflow status and configuration' },
  { key: 'activity', label: 'Activity', icon: Activity, description: 'History of application events' },
  { key: 'settings', label: 'Settings', icon: Settings2, description: 'Configure VoxTerm' }
]
