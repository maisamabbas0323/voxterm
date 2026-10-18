import type { ReactNode } from 'react'
import { Link2 } from 'lucide-react'
import type { ExternalSession } from '@shared/types'

interface ExternalSessionsProps {
  sessions: ExternalSession[]
  busy: boolean
  onAttach: (session: ExternalSession) => void
}

/**
 * A compact strip of tmux/screen sessions that are already running in the OS.
 * Discovery runs in the background while the Terminals view is open, so these
 * appear as one-click attach targets without opening the picker dialog first.
 * Nothing is ever attached automatically.
 */
export function ExternalSessions({ sessions, busy, onAttach }: ExternalSessionsProps): ReactNode {
  if (sessions.length === 0) return null
  return (
    <div className="external-strip" role="list" aria-label="Running tmux and screen sessions">
      <span className="external-strip__label" aria-hidden="true">
        <Link2 size={12} />
        External
        {busy ? <span className="external-strip__pulse" /> : null}
      </span>
      <div className="external-strip__scroll">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="listitem"
            className="external-chip"
            title={
              session.reason ??
              `${session.kind} session “${session.name}”${
                session.busy ? ' — currently in use, will join in shared mode' : ''
              }`
            }
            onClick={() => onAttach(session)}
          >
            <span className="external-chip__kind">{session.kind}</span>
            <span className="external-chip__name truncate">{session.name}</span>
            {session.busy ? <span className="external-chip__shared">shared</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
