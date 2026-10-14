/** Small formatting helpers for the renderer. */

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(from: number, to = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((to - from) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const HOME = '/home/'

/** Replace the user's home prefix with `~` for display only. */
export function shortenPath(path: string | null | undefined): string {
  if (!path) return ''
  const match = /^\/home\/[^/]+/.exec(path) ?? /^\/Users\/[^/]+/.exec(path)
  if (match && path.startsWith(match[0])) {
    return `~${path.slice(match[0].length)}`
  }
  if (path.startsWith(HOME)) return `~${path.slice(HOME.length)}`
  return path
}

export function clampText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}
