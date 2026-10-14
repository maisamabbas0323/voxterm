import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ActivityCategory, ActivityEvent, ActivityLevel } from '@shared/types'
import { JsonStore } from '../util/jsonStore'
import type { Logger } from '../util/logger'

interface ActivityFile {
  version: number
  events: ActivityEvent[]
}

export interface RecordActivityInput {
  category: ActivityCategory
  type: string
  message: string
  level?: ActivityLevel
  details?: Record<string, string | number | boolean | null>
}

const ABSOLUTE_MAX = 5000
/**
 * Identical consecutive events inside this window are merged into one row with
 * a repeat count instead of being logged separately (e.g. every slider change
 * used to produce its own "Settings updated" row).
 */
const MERGE_WINDOW_MS = 2 * 60 * 1000

/**
 * Bounded, persisted history of genuine application events. Only small,
 * explicitly-provided metadata is stored — never terminal output, environment
 * variables or credentials.
 */
export class ActivityLog {
  private events: ActivityEvent[] = []
  private readonly store: JsonStore<ActivityFile>
  private listeners = new Set<(event: ActivityEvent) => void>()
  private retention = 500
  private writeScheduled: NodeJS.Timeout | null = null

  constructor(
    private readonly logger: Logger,
    baseDir = app.getPath('userData')
  ) {
    this.store = new JsonStore<ActivityFile>(join(baseDir, 'activity.json'))
  }

  load(): void {
    const read = this.store.read()
    if (read.corrupted) {
      this.logger.warn('activity', 'Corrupted activity file backed up and reset')
      this.events = []
      return
    }
    const events = read.data?.events
    if (Array.isArray(events)) {
      this.events = events
        .filter(
          (event): event is ActivityEvent =>
            Boolean(event) &&
            typeof event === 'object' &&
            typeof (event as ActivityEvent).id === 'string' &&
            typeof (event as ActivityEvent).message === 'string'
        )
        .slice(-ABSOLUTE_MAX)
    }
  }

  setRetention(value: number): void {
    this.retention = Math.max(0, Math.min(ABSOLUTE_MAX, Math.floor(value)))
    if (this.events.length > this.retention) {
      this.events = this.events.slice(-this.retention)
      this.scheduleWrite()
    }
  }

  record(input: RecordActivityInput): ActivityEvent {
    const timestamp = Date.now()
    const last = this.events[this.events.length - 1]
    if (
      last &&
      last.category === input.category &&
      last.type === input.type &&
      last.message === input.message &&
      (last.level ?? 'info') === (input.level ?? 'info') &&
      timestamp - last.timestamp < MERGE_WINDOW_MS
    ) {
      // Coalesce: the newest occurrence updates the row instead of adding one.
      last.timestamp = timestamp
      last.count = (last.count ?? 1) + 1
      this.scheduleWrite()
      for (const listener of this.listeners) {
        try {
          listener(last)
        } catch {
          /* a broken listener must not break logging */
        }
      }
      return last
    }

    const event: ActivityEvent = {
      id: randomUUID(),
      timestamp,
      category: input.category,
      type: input.type,
      message: input.message,
      level: input.level ?? 'info',
      details: input.details ? sanitizeDetails(input.details) : undefined
    }
    // Keys are stable; `count` is only ever written by the coalescing branch above.
    this.events.push(event)
    if (this.events.length > ABSOLUTE_MAX) {
      this.events = this.events.slice(-ABSOLUTE_MAX)
    }
    this.scheduleWrite()
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* a broken listener must not break logging */
      }
    }
    return event
  }

  list(): ActivityEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
    this.scheduleWrite()
  }

  onEvent(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private scheduleWrite(): void {
    if (this.writeScheduled) return
    this.writeScheduled = setTimeout(() => {
      this.writeScheduled = null
      const trimmed =
        this.retention > 0 ? this.events.slice(-Math.min(this.retention, ABSOLUTE_MAX)) : []
      try {
        this.store.write({ version: 1, events: trimmed })
      } catch (error) {
        this.logger.warn('activity', `Failed to persist activity log: ${String(error)}`)
      }
    }, 500)
    this.writeScheduled.unref?.()
  }

  flush(): void {
    if (this.writeScheduled) {
      clearTimeout(this.writeScheduled)
      this.writeScheduled = null
    }
    const trimmed = this.retention > 0 ? this.events.slice(-Math.min(this.retention, ABSOLUTE_MAX)) : []
    try {
      this.store.write({ version: 1, events: trimmed })
    } catch {
      /* ignore */
    }
  }
}

const MAX_DETAIL_LENGTH = 300

function sanitizeDetails(
  details: Record<string, string | number | boolean | null>
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (typeof value === 'string') {
      output[key] = value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value
    } else {
      output[key] = value
    }
  }
  return output
}
