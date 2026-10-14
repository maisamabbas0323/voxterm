import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronsDown,
  Eraser,
  ExternalLink,
  Plug,
  Search,
  SquareTerminal,
  X
} from 'lucide-react'
import type { ExternalSessionInfo, TerminalSessionInfo } from '@shared/types'
import { useApp } from '../state/store'
import { TerminalSurface } from '../features/terminals/TerminalSurface'
import { TerminalTabs } from '../features/terminals/TerminalTabs'
import { ExternalPanel } from '../features/terminals/ExternalPanel'
import { terminalRegistry } from '../features/terminals/registry'
import { EmptyState, Notice, Pill } from '../components/primitives'
import { Modal } from '../components/Modal'
import { Tooltip } from '../components/Tooltip'
import { shortenPath } from '../lib/format'

type SearchStatus = 'idle' | 'found' | 'none'

export function TerminalsPage(): ReactNode {
  const { state, actions } = useApp()
  const { sessions, activeSessionId, settings } = state

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle')
  const [confirm, setConfirm] = useState<{ session: TerminalSessionInfo; mode: 'detach' | 'terminate' } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  // Respond to the global "find" shortcut dispatched by App.
  useEffect(() => {
    const handler = (): void => openSearch()
    window.addEventListener('voxterm:find', handler)
    return () => window.removeEventListener('voxterm:find', handler)
  }, [openSearch])

  // Keep every visible terminal fitted to the window.
  useEffect(() => {
    const onResize = (): void => terminalRegistry.refitAll()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Refresh external discovery when the terminals view becomes visible.
  useEffect(() => {
    if (state.external.length === 0) void actions.refreshExternal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = useCallback(
    (direction: 'next' | 'previous') => {
      if (!activeSessionId || !query) {
        setSearchStatus('idle')
        return
      }
      const controller = terminalRegistry.get(activeSessionId)
      if (!controller) return
      const found =
        direction === 'next' ? controller.findNext(query) : controller.findPrevious(query)
      setSearchStatus(found ? 'found' : 'none')
    },
    [activeSessionId, query]
  )

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setSearchStatus('idle')
    if (activeSessionId) terminalRegistry.get(activeSessionId)?.clearSearch()
  }, [activeSessionId])

  const requestClose = useCallback(
    (session: TerminalSessionInfo, mode: 'detach' | 'terminate') => {
      const confirmBefore =
        settings?.terminal.confirmBeforeTerminate ?? true
      const needsConfirm =
        session.origin === 'external'
          ? mode === 'terminate'
          : session.status === 'running' && confirmBefore
      if (needsConfirm) {
        setConfirm({ session, mode })
        return
      }
      void actions.closeSession(session.id, mode)
    },
    [actions, settings]
  )

  // Close the active session when App dispatches the global close shortcut.
  useEffect(() => {
    const handler = (): void => {
      const session = sessions.find((item) => item.id === activeSessionId)
      if (session) requestClose(session, 'terminate')
    }
    window.addEventListener('voxterm:close-active', handler)
    return () => window.removeEventListener('voxterm:close-active', handler)
  }, [sessions, activeSessionId, requestClose])

  const onAttach = useCallback(
    async (external: ExternalSessionInfo) => {
      const result = await window.voxterm.external.attach(external.id)
      if (result.ok && result.managedSessionId) {
        await actions.refreshSessions()
        actions.setActiveSession(result.managedSessionId)
        actions.toast(`Attached to ${external.name}.`, 'success')
      } else {
        actions.toast(result.message ?? `Unable to attach to ${external.name}.`, 'error')
      }
      void actions.refreshExternal()
    },
    [actions]
  )

  const onDetach = useCallback(
    async (external: ExternalSessionInfo) => {
      const result = await window.voxterm.external.detach(external.id)
      actions.toast(result.message ?? (result.ok ? 'Detached.' : 'Detach failed.'), result.ok ? 'info' : 'error')
      await actions.refreshSessions()
      void actions.refreshExternal()
    },
    [actions]
  )

  const onTerminateExternal = useCallback(
    async (external: ExternalSessionInfo) => {
      const result = await window.voxterm.external.terminate(external.id)
      actions.toast(
        result.message ?? (result.ok ? `Terminated ${external.name}.` : 'Terminate failed.'),
        result.ok ? 'info' : 'error'
      )
      await actions.refreshSessions()
      void actions.refreshExternal()
    },
    [actions]
  )

  const hasSessions = sessions.length > 0

  return (
    <div className="terminals">
      <TerminalTabs
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => actions.setActiveSession(id)}
        onRequestClose={requestClose}
        onRename={(id, title) => void actions.renameSession(id, title)}
        onCreate={() => void actions.createTerminal()}
      />

      <div className="terminals__layout">
        <div className="terminals__main">
          {activeSession ? (
            <div className="terminal-toolbar">
              <div className="terminal-meta">
                <Pill tone={activeSession.status === 'running' ? 'success' : 'neutral'}>
                  {activeSession.status}
                </Pill>
                <span className="mono truncate">{shortenPath(activeSession.cwd)}</span>
                <span className="muted mono">{activeSession.shellName}</span>
                {activeSession.pid !== null ? <span className="muted mono">pid {activeSession.pid}</span> : null}
                {activeSession.origin === 'external' ? <Pill tone="accent">external</Pill> : null}
              </div>
              <div className="row">
                <Tooltip label="Find (Ctrl+Shift+F)" placement="bottom">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label="Find in terminal"
                    onClick={() => (searchOpen ? closeSearch() : openSearch())}
                  >
                    <Search size={14} />
                  </button>
                </Tooltip>
                <Tooltip label="Scroll to bottom" placement="bottom">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label="Scroll terminal to bottom"
                    onClick={() => {
                      const controller = terminalRegistry.get(activeSession.id)
                      controller?.term.scrollToBottom()
                    }}
                  >
                    <ChevronsDown size={14} />
                  </button>
                </Tooltip>
                <Tooltip label="Clear scrollback" placement="bottom">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label="Clear terminal"
                    onClick={() => terminalRegistry.get(activeSession.id)?.clear()}
                  >
                    <Eraser size={14} />
                  </button>
                </Tooltip>
                <Tooltip label="Duplicate tab (new shell in same directory)" placement="bottom">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label="New terminal in the same directory"
                    onClick={() => void actions.createTerminal({ cwd: activeSession.cwd })}
                  >
                    <ExternalLink size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ) : null}

          <div className="terminal-viewport">
            {hasSessions && settings ? (
              sessions.map((session) => (
                <TerminalSurface
                  key={session.id}
                  sessionId={session.id}
                  active={session.id === activeSessionId}
                  settings={settings}
                />
              ))
            ) : (
              <EmptyState
                icon={<SquareTerminal size={26} />}
                title="No terminal sessions"
                text="Open a terminal to start a real shell. Sessions keep running while you switch tabs."
                action={
                  <button className="btn btn--primary" onClick={() => void actions.createTerminal()}>
                    <Plug size={15} />
                    New terminal
                  </button>
                }
              />
            )}

            {searchOpen ? (
              <div className="terminal-search" role="search">
                <Search size={14} className="muted" />
                <input
                  ref={searchInputRef}
                  className="input"
                  placeholder="Find…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSearchStatus('idle')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      runSearch(event.shiftKey ? 'previous' : 'next')
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      closeSearch()
                    }
                  }}
                />
                <span className="search-count">
                  {searchStatus === 'none' ? 'No match' : searchStatus === 'found' ? 'Match' : ''}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label="Close find"
                  onClick={closeSearch}
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
          </div>

          {activeSession && activeSession.status === 'exited' ? (
            <div style={{ padding: 'var(--space-3)' }}>
              <Notice tone="warning" icon={<SquareTerminal size={15} />}>
                This session has exited
                {activeSession.exitCode !== null ? ` with code ${activeSession.exitCode}` : ''}. The scrollback
                above is preserved. Start a new terminal to continue.
              </Notice>
            </div>
          ) : null}
        </div>

        <div className="terminals__side">
          <ExternalPanel
            providers={state.externalProviders}
            sessions={state.external}
            refreshing={state.externalRefreshing}
            onRefresh={() => void actions.refreshExternal()}
            onAttach={(session) => void onAttach(session)}
            onDetach={(session) => void onDetach(session)}
            onTerminate={(session) => void onTerminateExternal(session)}
            onOpen={(managedId) => {
              void actions.refreshSessions()
              actions.setActiveSession(managedId)
            }}
          />
        </div>
      </div>

      {confirm ? (
        <Modal
          title={confirm.session.origin === 'external' ? 'Terminate shared session' : 'Terminate session'}
          description={
            confirm.session.origin === 'external'
              ? `This ends the external session "${confirm.session.title}" for every client, not just VoxTerm.`
              : `The shell "${confirm.session.title}" and everything running inside it will be terminated.`
          }
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              {confirm.session.origin === 'external' ? (
                <button
                  className="btn"
                  onClick={() => {
                    const session = confirm.session
                    setConfirm(null)
                    void actions.closeSession(session.id, 'detach')
                  }}
                >
                  Detach instead
                </button>
              ) : null}
              <button
                className="btn btn--danger"
                data-autofocus
                onClick={() => {
                  const current = confirm
                  setConfirm(null)
                  void actions.closeSession(current.session.id, current.mode)
                }}
              >
                Terminate
              </button>
            </>
          }
        />
      ) : null}
    </div>
  )
}
