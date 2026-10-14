import { useEffect, useRef, type ReactNode } from 'react'
import type { Settings } from '@shared/schemas'
import { terminalRegistry } from './registry'

interface TerminalSurfaceProps {
  sessionId: string
  active: boolean
  settings: Settings
}

/**
 * Hosts the xterm.js instance for one session. Every session keeps its surface
 * mounted (hidden when inactive) so scrollback survives tab switches and no
 * shell is ever restarted just because the user looked elsewhere.
 */
export function TerminalSurface({ sessionId, active, settings }: TerminalSurfaceProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    terminalRegistry.register(sessionId, container, settingsRef.current)
  }, [sessionId])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      terminalRegistry.refit(sessionId)
      terminalRegistry.focus(sessionId)
    })
    return () => cancelAnimationFrame(frame)
  }, [sessionId, active])

  return (
    <div
      ref={containerRef}
      className={active ? 'terminal-surface terminal-surface--active' : 'terminal-surface'}
      data-session-id={sessionId}
      aria-hidden={!active}
    />
  )
}
