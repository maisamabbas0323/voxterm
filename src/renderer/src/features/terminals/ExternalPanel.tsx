import type { ReactNode } from 'react'
import { AlertTriangle, ExternalLink, Plug, PlugZap, RefreshCw, Power, Unplug } from 'lucide-react'
import type { ExternalProviderInfo, ExternalSessionInfo, ExternalSessionState } from '@shared/types'
import { StatusDot, type DotState } from '../../components/primitives'
import { Tooltip } from '../../components/Tooltip'

interface ExternalPanelProps {
  providers: ExternalProviderInfo[]
  sessions: ExternalSessionInfo[]
  refreshing: boolean
  onRefresh: () => void
  onAttach: (session: ExternalSessionInfo) => void
  onDetach: (session: ExternalSessionInfo) => void
  onTerminate: (session: ExternalSessionInfo) => void
  onOpen: (managedSessionId: string) => void
}

const STATE_LABEL: Record<ExternalSessionState, string> = {
  detected: 'Detected',
  attachable: 'Attachable',
  connected: 'Connected',
  detached: 'Detached',
  exited: 'Exited',
  unsupported: 'Unsupported',
  attach_failed: 'Attach failed'
}

function dotFor(state: ExternalSessionState): DotState {
  return state
}

/**
 * Side panel listing integration providers and the external sessions VoxTerm
 * has genuinely detected. Nothing here is simulated: a session only reads
 * "Connected" once VoxTerm holds a real client to it.
 */
export function ExternalPanel({
  providers,
  sessions,
  refreshing,
  onRefresh,
  onAttach,
  onDetach,
  onTerminate,
  onOpen
}: ExternalPanelProps): ReactNode {
  const availableProviders = providers.filter((provider) => provider.available)
  const disabledProviders = providers.filter((provider) => !provider.available)

  return (
    <div className="external-panel">
      <div className="external-panel__header">
        <div className="col">
          <span className="panel__title">External sessions</span>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {availableProviders.length} of {providers.length} providers available
          </span>
        </div>
        <Tooltip label="Rescan now" placement="bottom">
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label="Refresh external sessions"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
          </button>
        </Tooltip>
      </div>

      <div className="external-panel__body">
        {sessions.length === 0 ? (
          <div className="empty" style={{ height: 'auto', padding: 'var(--space-6) var(--space-4)' }}>
            <div className="empty__icon">
              <Plug size={20} />
            </div>
            <div className="empty__title">No external sessions</div>
            <p className="empty__text">
              VoxTerm scans for tmux, GNU screen and other terminal servers. Start one in an external terminal
              and it will appear here.
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <div className="external-card" key={session.id}>
              <div className="row">
                <StatusDot state={dotFor(session.state)} />
                <span className="grow truncate" style={{ fontWeight: 500 }}>
                  {session.name}
                </span>
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {STATE_LABEL[session.state]}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
                {session.providerId}
                {session.windows !== null ? ` · ${session.windows} windows` : ''}
                {session.attachedClients !== null ? ` · ${session.attachedClients} attached` : ''}
                {session.pid !== null ? ` · pid ${session.pid}` : ''}
              </div>
              {session.detail ? (
                <div className="row" style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>
                  <AlertTriangle size={12} />
                  <span>{session.detail}</span>
                </div>
              ) : null}
              <div className="external-card__actions">
                {session.state === 'connected' && session.managedSessionId ? (
                  <button className="btn btn--sm" onClick={() => onOpen(session.managedSessionId as string)}>
                    <ExternalLink size={13} />
                    Open tab
                  </button>
                ) : null}
                {session.state === 'connected' ? (
                  <button className="btn btn--sm" onClick={() => onDetach(session)}>
                    <Unplug size={13} />
                    Detach
                  </button>
                ) : (
                  <button
                    className="btn btn--sm"
                    disabled={!session.attachable}
                    title={session.attachable ? undefined : 'This provider cannot attach to the session'}
                    onClick={() => onAttach(session)}
                  >
                    <PlugZap size={13} />
                    Attach
                  </button>
                )}
                {session.terminatable ? (
                  <button className="btn btn--sm btn--danger" onClick={() => onTerminate(session)}>
                    <Power size={13} />
                    Terminate
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}

        {disabledProviders.length > 0 ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div className="section-title" style={{ marginBottom: 'var(--space-2)' }}>
              Unavailable providers
            </div>
            <ul className="stack stack--sm">
              {disabledProviders.map((provider) => (
                <li key={provider.id} className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>{provider.name}</strong>
                  {provider.reason ? ` — ${provider.reason}` : ' — not installed'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
