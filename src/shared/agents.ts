/** Built-in agent profile suggestions. Availability is determined at runtime. */
import type { AgentProfile } from './types'

export const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'builtin-opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    description: 'OpenCode terminal coding agent.',
    icon: 'Bot',
    kind: 'builtin',
    capabilities: { promptInjection: false, structuredEvents: false }
  },
  {
    id: 'builtin-claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    description: 'Anthropic Claude Code CLI.',
    icon: 'Sparkles',
    kind: 'builtin',
    capabilities: { promptInjection: false, structuredEvents: false }
  },
  {
    id: 'builtin-codex',
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    description: 'OpenAI Codex CLI.',
    icon: 'Terminal',
    kind: 'builtin',
    capabilities: { promptInjection: false, structuredEvents: false }
  },
  {
    id: 'builtin-gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    description: 'Google Gemini CLI.',
    icon: 'Gem',
    kind: 'builtin',
    capabilities: { promptInjection: false, structuredEvents: false }
  },
  {
    id: 'builtin-aider',
    name: 'Aider',
    command: 'aider',
    args: [],
    description: 'AI pair programming in the terminal.',
    icon: 'GitBranch',
    kind: 'builtin',
    capabilities: { promptInjection: false, structuredEvents: false }
  }
]

/** Icons offered when creating a custom agent profile. */
export const AGENT_ICON_NAMES = [
  'Bot',
  'Sparkles',
  'Terminal',
  'Gem',
  'GitBranch',
  'Cpu',
  'Wand2',
  'Command'
] as const
