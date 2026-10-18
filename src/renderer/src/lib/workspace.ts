import type { ActivityEvent, SystemInfo, ToolAvailability } from '@shared/types'

export interface MergedActivityRow {
  id: string
  type: string
  message: string
  category: ActivityEvent['category']
  level: ActivityEvent['level']
  timestamp: number
  /** Number of identical consecutive occurrences this row represents. */
  count: number
}

const MERGE_WINDOW_MS = 2 * 60 * 1000

/**
 * Collapse identical consecutive activity rows (same category, type, message
 * and level) within a short window into one row carrying a repeat count.
 * Pure over its input so the UI can merge for display regardless of what the
 * main-process log already coalesced.
 */
export function mergeActivityRepeats(events: ActivityEvent[]): MergedActivityRow[] {
  const rows: MergedActivityRow[] = []
  for (const event of events) {
    const last = rows[rows.length - 1]
    if (
      last &&
      last.category === event.category &&
      last.type === event.type &&
      last.message === event.message &&
      last.level === event.level &&
      event.timestamp - last.timestamp < MERGE_WINDOW_MS
    ) {
      last.timestamp = event.timestamp
      last.count += 1
      continue
    }
    rows.push({
      id: event.id,
      type: event.type,
      message: event.message,
      category: event.category,
      level: event.level,
      timestamp: event.timestamp,
      count: 1
    })
  }
  return rows
}

export interface ToolGroup {
  label: string
  items: ToolAvailability[]
}

/** Group detected tooling chips by kind, preserving tool order. Pure. */
export function groupDetectedTooling(system: SystemInfo): ToolGroup[] {
  return [
    { label: 'Shells', items: system.shells },
    { label: 'Multiplexers', items: [system.tmux, system.screen] },
    { label: 'Coding agents', items: system.agents }
  ].filter((group) => group.items.length > 0)
}

/** Plain-text dump of the system panel for bug reports. Pure. */
export function systemInfoToText(system: SystemInfo): string {
  return [
    `VoxTerm ${system.appVersion}`,
    `Electron ${system.electron} / Chrome ${system.chrome}`,
    `Node ${system.node} / V8 ${system.v8}`,
    `Platform ${system.platform} ${system.arch} (${system.osRelease})`,
    `Host ${system.hostname}`,
    `Default shell ${system.defaultShell}`,
    `node-pty ${system.terminalBackend.nodePty ? 'ready' : `unavailable${system.terminalBackend.error ? `: ${system.terminalBackend.error}` : ''}`}${system.terminalBackend.ptyVersion ? ` (${system.terminalBackend.ptyVersion})` : ''}`,
    `Speech-to-text ${system.stt.configured ? 'ready' : 'not configured'}${system.stt.detail ? ` — ${system.stt.detail}` : ''}`
  ].join('\n')
}
