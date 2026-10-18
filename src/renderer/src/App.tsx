import { useEffect, useMemo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useApp } from './state/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ToastStack } from './components/Toasts'
import { Modal } from './components/Modal'
import { Logo } from './components/Logo'
import { NAV_ITEMS } from './components/nav'
import { terminalRegistry } from './features/terminals/registry'
import { TerminalsPage } from './pages/TerminalsPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { ActivityPage } from './pages/ActivityPage'
import { SettingsPage } from './pages/SettingsPage'

function LoadingScreen(): ReactNode {
  return (
    <div className="boot">
      <Logo size={64} plate className="boot__logo" />
      <div className="boot__name">VoxTerm</div>
      <div className="boot__tagline">Terminal workspace</div>
      <div className="boot__bar" aria-hidden="true">
        <span />
      </div>
      <p className="boot__text">Preparing the terminal backend and loading your workspace…</p>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }): ReactNode {
  return (
    <div className="boot">
      <div className="boot__error-icon">
        <AlertTriangle size={30} />
      </div>
      <div className="boot__name">VoxTerm failed to start</div>
      <p className="boot__text">{message}</p>
    </div>
  )
}

export function App(): ReactNode {
  const { state, actions } = useApp()
  const { nav, sessions, activeSessionId, closePrompt } = state

  const contextLabel = useMemo(() => NAV_ITEMS.find((item) => item.key === nav)?.label, [nav])

  // Global keyboard shortcuts. Terminal-local bindings (copy, find) live in the
  // terminal surface; these operate on the application as a whole. The listener
  // runs in the capture phase and consumes handled keys, so a shortcut never
  // also types a control character into the focused shell.
  //
  // Find (Ctrl+F / Ctrl+Shift+F) is deliberately scoped to the Terminals view.
  // It is not consumed anywhere else, so it can never open terminal search from
  // another page or the surrounding interface.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      // Key auto-repeat must never re-fire a toggle.
      if (event.repeat) return
      const key = event.key.toLowerCase()

      const consume = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      // Ctrl +/−/0 resize the terminal font. Zoom is deliberately scoped to the
      // terminal: the main process disables page zoom, so the surrounding
      // interface never scales with it.
      const zoomIn = key === '=' || key === '+'
      const zoomOut = key === '-' || key === '_'
      const zoomReset = key === '0' && !event.shiftKey
      if ((zoomIn || zoomOut || zoomReset) && nav === 'terminals' && sessions.length > 0) {
        consume()
        if (zoomReset) terminalRegistry.resetZoom()
        else terminalRegistry.zoomBy(zoomIn ? 1 : -1)
        return
      }

      // Find only ever works inside the Terminals view — never on another page
      // and never outside the app.
      if (key === 'f' && nav === 'terminals') {
        consume()
        setTimeout(() => window.dispatchEvent(new CustomEvent('voxterm:find')), 0)
        return
      }

      if (event.shiftKey && key === 't') {
        consume()
        void actions.createTerminal()
        return
      }
      if (event.shiftKey && key === 'w') {
        consume()
        actions.navigate('terminals')
        setTimeout(() => window.dispatchEvent(new CustomEvent('voxterm:close-active')), 0)
        return
      }
      if (event.key === 'Tab') {
        consume()
        if (sessions.length < 2) return
        const currentIndex = sessions.findIndex((session) => session.id === activeSessionId)
        const delta = event.shiftKey ? -1 : 1
        const nextIndex = (currentIndex + delta + sessions.length) % sessions.length
        actions.setActiveSession(sessions[nextIndex].id)
        actions.navigate('terminals')
        return
      }
      if (/^[1-9]$/.test(event.key) && !event.shiftKey) {
        const index = Number(event.key)
        const target = index === 9 ? sessions[sessions.length - 1] : sessions[index - 1]
        if (target) {
          consume()
          actions.setActiveSession(target.id)
          actions.navigate('terminals')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [actions, sessions, activeSessionId, nav])

  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'error') return <ErrorScreen message={state.error ?? 'Unknown error'} />

  return (
    <div className="app">
      <TitleBar contextLabel={contextLabel} />
      <div className="app-body">
        <Sidebar active={nav} onNavigate={actions.navigate} />
        <main className="app-main">
          {nav === 'workspace' ? <WorkspacePage /> : null}
          {nav === 'terminals' ? <TerminalsPage /> : null}
          {nav === 'activity' ? <ActivityPage /> : null}
          {nav === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>

      <ToastStack toasts={state.toasts} onDismiss={actions.dismissToast} />

      {closePrompt ? (
        <Modal
          title="Quit VoxTerm?"
          description={`${closePrompt.runningSessions} of ${closePrompt.totalSessions} sessions are still running.`}
          onClose={() => void actions.respondToClose(false)}
          footer={
            <>
              <button className="btn" onClick={() => void actions.respondToClose(false)}>
                Cancel
              </button>
              <button className="btn btn--danger" data-autofocus onClick={() => void actions.respondToClose(true)}>
                Quit
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}>
            Running shells will be closed according to your privacy preference. You can keep managed shells
            running by choosing “Keep managed shells running” in Settings → Privacy.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
