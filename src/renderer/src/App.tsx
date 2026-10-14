import { useEffect, useMemo, type ReactNode } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { useApp } from './state/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ToastStack } from './components/Toasts'
import { Modal } from './components/Modal'
import { NAV_ITEMS } from './components/nav'
import { TerminalsPage } from './pages/TerminalsPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { ActivityPage } from './pages/ActivityPage'
import { VoicePage } from './pages/VoicePage'
import { SettingsPage } from './pages/SettingsPage'

function LoadingScreen(): ReactNode {
  return (
    <div className="empty" style={{ height: '100vh' }}>
      <div className="empty__icon">
        <Layers size={26} />
      </div>
      <div className="empty__title">Starting VoxTerm</div>
      <p className="empty__text">Preparing terminal backend and loading your workspace.</p>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }): ReactNode {
  return (
    <div className="empty" style={{ height: '100vh' }}>
      <div className="empty__icon" style={{ color: 'var(--danger)' }}>
        <AlertTriangle size={26} />
      </div>
      <div className="empty__title">VoxTerm failed to start</div>
      <p className="empty__text">{message}</p>
    </div>
  )
}

export function App(): ReactNode {
  const { state, actions } = useApp()
  const { nav, sessions, activeSessionId, closePrompt } = state

  const contextLabel = useMemo(() => NAV_ITEMS.find((item) => item.key === nav)?.label, [nav])

  // Global keyboard shortcuts. Terminal-local bindings (copy, find) remain in
  // the terminal surface; these operate on the application as a whole.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()

      if (event.shiftKey && key === 't') {
        event.preventDefault()
        void actions.createTerminal()
        return
      }
      if (event.shiftKey && key === 'w') {
        event.preventDefault()
        actions.navigate('terminals')
        setTimeout(() => window.dispatchEvent(new CustomEvent('voxterm:close-active')), 0)
        return
      }
      if (event.shiftKey && key === 'f') {
        event.preventDefault()
        actions.navigate('terminals')
        setTimeout(() => window.dispatchEvent(new CustomEvent('voxterm:find')), 0)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
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
          event.preventDefault()
          actions.setActiveSession(target.id)
          actions.navigate('terminals')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, sessions, activeSessionId])

  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'error') return <ErrorScreen message={state.error ?? 'Unknown error'} />

  return (
    <div className="app">
      <TitleBar contextLabel={contextLabel} />
      <div className="app-body">
        <Sidebar
          active={nav}
          expanded={state.sidebarExpanded}
          onNavigate={actions.navigate}
          onToggleExpanded={actions.toggleSidebar}
        />
        <main className="app-main">
          {nav === 'workspace' ? <WorkspacePage /> : null}
          {nav === 'terminals' ? <TerminalsPage /> : null}
          {nav === 'voice' ? <VoicePage /> : null}
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
