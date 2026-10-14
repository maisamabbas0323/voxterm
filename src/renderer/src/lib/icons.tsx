import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Command,
  Cpu,
  Gem,
  GitBranch,
  Sparkles,
  Terminal,
  Wand2
} from 'lucide-react'

/** Maps the icon names stored on agent profiles to SVG icon components. */
export const AGENT_ICONS: Record<string, LucideIcon> = {
  Bot,
  Sparkles,
  Terminal,
  Gem,
  GitBranch,
  Cpu,
  Wand2,
  Command
}

export function agentIcon(name: string | undefined): LucideIcon {
  if (name && AGENT_ICONS[name]) return AGENT_ICONS[name]
  return Terminal
}
