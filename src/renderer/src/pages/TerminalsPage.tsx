import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronsDown, Copy, Eraser, Minus, Plus, Search, SquareTerminal, X } from 'lucide-react'
import type { TerminalSessionInfo } from '@shared/types'
import { useApp } from '../state/store'
import { TerminalSurface } from '../features/terminals/TerminalSurface'
import { TerminalTabs } from '../features/terminals/TerminalTabs'
import { terminalRegistry } from '../features/terminals/registry'
import { EmptyState, Notice } from '../components/primitives'
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
  const [confirm, setConfirm] = useState<TerminalSessionInfo | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Terminal zoom only ever changes the font size, so zooming never scales the
  // surrounding interface. The registry owns the value; this mirrors it.
  const [zoom, setZoom] = useState(() => terminalRegistry.getZoom())
  const fontSize = useMemo(() => terminalRegistry.effectiveFontSize(), [zoom, settings])

  // Live grid dimensions of the active session, read straight from xterm.
  const [dims, setDims] = useState<{ cols: number; rows: number } | null>(null)

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

  useEffect(() => terminalRegistry.onZoomChange(setZoom), [])

  // Track the active terminal's grid size so the toolbar can report it.
  useEffect(() => {
    const controller = activeSessionId ? terminalRegistry.get(activeSessionId) : undefined
    if (!controller) {
      setDims(null)
      return
    }
    const sync = (): void => setDims({ cols: controller.term.cols, rows: controller.term.rows })
    sync()
    const subscription = controller.term.onResize(sync)
    return () => subscription.dispose()
  }, [activeSessionId, sessions])

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
    (session: TerminalSessionInfo) => {
      const confirmBefore = settings?.terminal.confirmBeforeTerminate ?? true
      if (session.status === 'running' && confirmBefore) {
        setConfirm(session)
        return
      }
      void actions.closeSession(session.id)
    },
    [actions, settings]
  )

  // Close the active session when App dispatches the global close shortcut.
  useEffect(() => {
    const handler = (): void => {
      const session = sessions.find((item) => item.id === activeSessionId)
      if (session) requestClose(session)
    }
    window.addEventListener('voxterm:close-active', handler)
    return () => window.removeEventListener('voxterm:close-active', handler)
  }, [sessions, activeSessionId, requestClose])

  const hasSessions = sessions.length > 0
  const runningCount = sessions.filter((session) => session.status === 'running').length

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

      <div className="terminals__main">
        {activeSession ? (
          <div className="terminal-toolbar">
            <div className="terminal-meta">
              <span
                className={activeSession.status === 'running' ? 'dot dot--running' : 'dot dot--exited'}
                aria-hidden="true"
              />
              <span className="terminal-meta__title truncate">{activeSession.title}</span>
              <span className="terminal-meta__sep" aria-hidden="true" />
              <span className="terminal-meta__item mono truncate" title={activeSession.cwd}>
                {shortenPath(activeSession.cwd) || '~'}
              </span>
              <span className="terminal-meta__item terminal-meta__item--secondary mono">
                {activeSession.shellName}
              </span>
              {activeSession.pid !== null ? (
                <span className="terminal-meta__item terminal-meta__item--secondary mono">
                  pid {activeSession.pid}
                </span>
              ) : null}
              {dims ? (
                <span className="terminal-meta__item terminal-meta__item--secondary mono">
                  {dims.cols}×{dims.rows}
                </span>
              ) : null}
            </div>
            <div className="terminal-toolbar__actions">
              <Tooltip label="Find in terminal (Ctrl+Shift+F)" placement="bottom">
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
                  onClick={() => terminalRegistry.get(activeSession.id)?.term.scrollToBottom()}
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
              <Tooltip label="Copy working directory" placement="bottom">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label="Copy working directory"
                  onClick={() => void window.voxterm.clipboard.writeText(activeSession.cwd)}
                >
                  <Copy size={14} />
                </button>
              </Tooltip>
              <Tooltip label="New shell in the same directory" placement="bottom">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label="New terminal in the same directory"
                  onClick={() => void actions.createTerminal({ cwd: activeSession.cwd })}
                >
                  <Plus size={14} />
                </button>
              </Tooltip>
              <Tooltip label="Zoom the terminal — Ctrl +/−, Ctrl+0 to reset" placement="bottom">
                <span className="terminal-zoom" role="group" aria-label="Terminal zoom">
                  <button
                    type="button"
                    className="terminal-zoom__button"
                    aria-label="Zoom terminal out"
                    onClick={() => terminalRegistry.zoomBy(-1)}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    className="terminal-zoom__value"
                    aria-label="Reset terminal zoom"
                    onClick={() => terminalRegistry.resetZoom()}
                  >
                    {fontSize}px
                  </button>
                  <button
                    type="button"
                    className="terminal-zoom__button"
                    aria-label="Zoom terminal in"
                    onClick={() => terminalRegistry.zoomBy(1)}
                  >
                    <Plus size={13} />
                  </button>
                </span>
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
                  <Plus size={15} />
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
                aria-label="Find in terminal"
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
          <div className="terminals__notice">
            <Notice tone="warning" icon={<SquareTerminal size={15} />}>
              This session has exited
              {activeSession.exitCode !== null ? ` with code ${activeSession.exitCode}` : ''}. The scrollback
              above is preserved — start a new terminal to continue.
            </Notice>
          </div>
        ) : null}
      </div>

      {confirm ? (
        <Modal
          title="Terminate session"
          description={`The shell "${confirm.title}" and everything running inside it will be terminated.`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn--danger"
                data-autofocus
                onClick={() => {
                  const session = confirm
                  setConfirm(null)
                  void actions.closeSession(session.id)
                }}
              >
                Terminate
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}>
            {runningCount} of {sessions.length} sessions are running. You can disable this confirmation in
            Settings → Terminal.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
