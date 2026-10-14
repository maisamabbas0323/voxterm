import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type {
  ActivityEvent,
  AgentProfileStatus,
  SystemInfo,
  TerminalSessionInfo
} from '@shared/types'
import type { SecretsStatus, Settings } from '@shared/schemas'
import type { AppCloseRequestPayload } from '@shared/api'
import type { NavKey } from '../components/nav'
import type { ToastRecord } from '../components/Toasts'
import { terminalRegistry } from '../features/terminals/registry'

interface State {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  settings: Settings | null
  secrets: SecretsStatus
  sessions: TerminalSessionInfo[]
  activeSessionId: string | null
  activity: ActivityEvent[]
  system: SystemInfo | null
  agents: AgentProfileStatus[]
  nav: NavKey
  toasts: ToastRecord[]
  closePrompt: AppCloseRequestPayload | null
}

type Action =
  | {
      type: 'init'
      payload: {
        settings: Settings
        secrets: SecretsStatus
        sessions: TerminalSessionInfo[]
        activity: ActivityEvent[]
        system: SystemInfo
        agents: AgentProfileStatus[]
      }
    }
  | { type: 'failed'; error: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'secrets'; secrets: SecretsStatus }
  | { type: 'sessions'; sessions: TerminalSessionInfo[] }
  | { type: 'upsert-session'; session: TerminalSessionInfo }
  | { type: 'active'; id: string | null }
  | { type: 'activity'; events: ActivityEvent[] }
  | { type: 'activity-add'; event: ActivityEvent }
  | { type: 'system'; system: SystemInfo }
  | { type: 'agents'; agents: AgentProfileStatus[] }
  | { type: 'nav'; nav: NavKey }
  | { type: 'toast-add'; toast: ToastRecord }
  | { type: 'toast-dismiss'; id: string }
  | { type: 'close-prompt'; payload: AppCloseRequestPayload | null }

const initialState: State = {
  status: 'loading',
  error: null,
  settings: null,
  secrets: { openrouter: false, google: false, elevenlabs: false },
  sessions: [],
  activeSessionId: null,
  activity: [],
  system: null,
  agents: [],
  nav: 'terminals',
  toasts: [],
  closePrompt: null
}

function pickActive(sessions: TerminalSessionInfo[], current: string | null): string | null {
  if (current && sessions.some((session) => session.id === current)) return current
  const running = sessions.find((session) => session.status === 'running')
  return running?.id ?? sessions[0]?.id ?? null
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'init': {
      const sessions = action.payload.sessions
      return {
        ...state,
        status: 'ready',
        error: null,
        settings: action.payload.settings,
        secrets: action.payload.secrets,
        sessions,
        activeSessionId: pickActive(sessions, state.activeSessionId),
        activity: action.payload.activity,
        system: action.payload.system,
        agents: action.payload.agents
      }
    }
    case 'failed':
      return { ...state, status: 'error', error: action.error }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'secrets':
      return { ...state, secrets: action.secrets }
    case 'sessions':
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: pickActive(action.sessions, state.activeSessionId)
      }
    case 'upsert-session': {
      const exists = state.sessions.some((session) => session.id === action.session.id)
      const sessions = exists
        ? state.sessions.map((session) => (session.id === action.session.id ? action.session : session))
        : [...state.sessions, action.session]
      return { ...state, sessions, activeSessionId: pickActive(sessions, state.activeSessionId) }
    }
    case 'active':
      return { ...state, activeSessionId: action.id }
    case 'activity':
      return { ...state, activity: action.events }
    case 'activity-add': {
      // Coalesced events are re-broadcast with the same id; replace in place so
      // the merged row updates instead of appending a duplicate.
      const events = [...state.activity]
      const last = events[events.length - 1]
      if (last && last.id === action.event.id) {
        events[events.length - 1] = action.event
      } else {
        events.push(action.event)
      }
      return { ...state, activity: events.slice(-2000) }
    }
    case 'system':
      return { ...state, system: action.system }
    case 'agents':
      return { ...state, agents: action.agents }
    case 'nav':
      return { ...state, nav: action.nav }
    case 'toast-add':
      return { ...state, toasts: [...state.toasts, action.toast] }
    case 'toast-dismiss':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) }
    case 'close-prompt':
      return { ...state, closePrompt: action.payload }
    default:
      return state
  }
}

interface AppActions {
  navigate: (key: NavKey) => void
  setActiveSession: (id: string) => void
  createTerminal: (options?: { cwd?: string; title?: string; shell?: string; args?: string[] }) => Promise<TerminalSessionInfo | null>
  renameSession: (id: string, title: string) => Promise<void>
  closeSession: (id: string) => Promise<void>
  refreshSessions: () => Promise<void>
  refreshSystem: () => Promise<void>
  refreshAgents: () => Promise<void>
  refreshSecrets: () => Promise<void>
  loadActivity: () => Promise<void>
  clearActivity: () => Promise<void>
  updateSettings: (patch: unknown) => Promise<void>
  resetSettings: () => Promise<void>
  setSecret: (slot: string, value: string) => Promise<void>
  clearSecret: (slot: string) => Promise<void>
  toast: (message: string, tone?: ToastRecord['tone']) => void
  dismissToast: (id: string) => void
  respondToClose: (confirm: boolean) => Promise<void>
}

const AppContext = createContext<{ state: State; actions: AppActions } | null>(null)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(reducer, initialState)
  const autoCreated = useRef(false)

  const toast = useCallback((message: string, tone: ToastRecord['tone'] = 'info') => {
    dispatch({
      type: 'toast-add',
      toast: { id: crypto.randomUUID(), message, tone }
    })
  }, [])

  const dismissToast = useCallback((id: string) => dispatch({ type: 'toast-dismiss', id }), [])

  const refreshSessions = useCallback(async () => {
    const sessions = await window.voxterm.terminals.list()
    dispatch({ type: 'sessions', sessions })
  }, [])

  const refreshSystem = useCallback(async () => {
    const system = await window.voxterm.system.info()
    dispatch({ type: 'system', system })
  }, [])

  const refreshAgents = useCallback(async () => {
    const agents = await window.voxterm.agents.list()
    dispatch({ type: 'agents', agents })
  }, [])

  const refreshSecrets = useCallback(async () => {
    const secrets = await window.voxterm.settings.secretsStatus()
    dispatch({ type: 'secrets', secrets })
  }, [])

  const loadActivity = useCallback(async () => {
    const events = await window.voxterm.activity.list()
    dispatch({ type: 'activity', events })
  }, [])

  const createTerminal = useCallback<AppActions['createTerminal']>(
    async (options) => {
      try {
        const session = await window.voxterm.terminals.create(options ?? {})
        dispatch({ type: 'upsert-session', session })
        dispatch({ type: 'active', id: session.id })
        return session
      } catch (error) {
        toast(`Could not create terminal: ${errorMessage(error)}`, 'error')
        return null
      }
    },
    [toast]
  )

  const renameSession = useCallback<AppActions['renameSession']>(
    async (id, title) => {
      try {
        const result = await window.voxterm.terminals.rename(id, title)
        if (!result.ok) toast('Rename failed', 'error')
      } catch (error) {
        toast(`Rename failed: ${errorMessage(error)}`, 'error')
      }
    },
    [toast]
  )

  const closeSession = useCallback<AppActions['closeSession']>(
    async (id) => {
      try {
        const result = await window.voxterm.terminals.close(id)
        terminalRegistry.dispose(id)
        dispatch({ type: 'sessions', sessions: await window.voxterm.terminals.list() })
        if (result.message) {
          toast(result.message, result.terminated ? 'info' : 'error')
        }
      } catch (error) {
        toast(`Close failed: ${errorMessage(error)}`, 'error')
      }
    },
    [toast]
  )

  const updateSettings = useCallback<AppActions['updateSettings']>(
    async (patch) => {
      try {
        const settings = await window.voxterm.settings.update(patch)
        dispatch({ type: 'settings', settings })
      } catch (error) {
        toast(`Settings not saved: ${errorMessage(error)}`, 'error')
      }
    },
    [toast]
  )

  const resetSettings = useCallback(async () => {
    const settings = await window.voxterm.settings.reset()
    dispatch({ type: 'settings', settings })
    toast('Settings restored to defaults', 'info')
  }, [toast])

  const setSecret = useCallback(
    async (slot: string, value: string) => {
      const result = await window.voxterm.settings.setSecret(slot, value)
      if (!result.ok) {
        toast(result.message ?? 'Could not store credential', 'error')
        return
      }
      await refreshSecrets()
      toast(value.trim() ? 'Credential stored.' : 'Credential cleared.', 'success')
    },
    [refreshSecrets, toast]
  )

  const clearSecret = useCallback(
    async (slot: string) => {
      await window.voxterm.settings.clearSecret(slot)
      await refreshSecrets()
      toast('Credential cleared.', 'info')
    },
    [refreshSecrets, toast]
  )

  const clearActivity = useCallback(async () => {
    await window.voxterm.activity.clear()
    await loadActivity()
  }, [loadActivity])

  const respondToClose = useCallback(async (confirm: boolean) => {
    dispatch({ type: 'close-prompt', payload: null })
    await window.voxterm.app.respondClose({ confirm })
  }, [])

  // ---- Initial load + event subscriptions (set up exactly once) ----
  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const [settings, secrets, sessions, activity, system, agents] = await Promise.all([
          window.voxterm.settings.get(),
          window.voxterm.settings.secretsStatus(),
          window.voxterm.terminals.list(),
          window.voxterm.activity.list(),
          window.voxterm.system.info(),
          window.voxterm.agents.list()
        ])
        if (cancelled) return
        dispatch({
          type: 'init',
          payload: { settings, secrets, sessions, activity, system, agents }
        })
      } catch (error) {
        if (!cancelled) dispatch({ type: 'failed', error: errorMessage(error) })
      }
    }

    void load()

    const unsubscribers = [
      window.voxterm.settings.onChanged((settings) => dispatch({ type: 'settings', settings })),
      window.voxterm.terminals.onSessionChanged((session) => dispatch({ type: 'upsert-session', session })),
      window.voxterm.terminals.onListChanged((sessions) => dispatch({ type: 'sessions', sessions })),
      window.voxterm.activity.onEvent((event) => dispatch({ type: 'activity-add', event })),
      window.voxterm.app.onCloseRequested((payload) => dispatch({ type: 'close-prompt', payload }))
    ]

    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  // Initialise the xterm data router once.
  useEffect(() => {
    terminalRegistry.init()
  }, [])

  // Auto-create one real terminal on first launch with no sessions.
  useEffect(() => {
    if (state.status !== 'ready' || autoCreated.current) return
    autoCreated.current = true
    if (state.sessions.length === 0) {
      void createTerminal()
    }
  }, [state.status, state.sessions.length, createTerminal])

  // Apply appearance preferences to terminal instances and the document.
  useEffect(() => {
    if (!state.settings) return
    terminalRegistry.applyAppearance(state.settings)
    const root = document.documentElement
    root.dataset.motion = state.settings.appearance.reducedMotion ? 'reduced' : state.settings.appearance.animationIntensity
    root.dataset.reducedMotion = String(state.settings.appearance.reducedMotion)
    root.dataset.density = state.settings.appearance.interfaceDensity
  }, [state.settings])

  const actions = useMemo<AppActions>(
    () => ({
      navigate: (nav) => dispatch({ type: 'nav', nav }),
      setActiveSession: (id) => {
        dispatch({ type: 'active', id })
        terminalRegistry.focus(id)
      },
      createTerminal,
      renameSession,
      closeSession,
      refreshSessions,
      refreshSystem,
      refreshAgents,
      refreshSecrets,
      loadActivity,
      clearActivity,
      updateSettings,
      resetSettings,
      setSecret,
      clearSecret,
      toast,
      dismissToast,
      respondToClose
    }),
    [
      createTerminal,
      renameSession,
      closeSession,
      refreshSessions,
      refreshSystem,
      refreshAgents,
      refreshSecrets,
      loadActivity,
      clearActivity,
      updateSettings,
      resetSettings,
      setSecret,
      clearSecret,
      toast,
      dismissToast,
      respondToClose
    ]
  )

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): { state: State; actions: AppActions } {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}
