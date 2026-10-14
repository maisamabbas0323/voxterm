import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Cpu,
  KeyRound,
  Mic,
  Palette,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  Volume2,
  Wand2
} from 'lucide-react'
import { SETTINGS_SECTIONS, type SecretSlot, type Settings, type SettingsSection } from '@shared/schemas'
import { useApp } from '../state/store'
import { Notice, Switch } from '../components/primitives'
import { shortenPath } from '../lib/format'
import { TERMINAL_FONTS, findTerminalFont } from '../lib/fonts'

const SECTION_LABELS: Record<SettingsSection, string> = {
  appearance: 'Appearance',
  terminal: 'Terminal',
  voice: 'Voice',
  prompts: 'Prompt providers',
  announcements: 'Announcements',
  privacy: 'Privacy',
  system: 'System & credentials'
}

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  appearance: Palette,
  terminal: SquareTerminal,
  voice: Mic,
  prompts: Wand2,
  announcements: Volume2,
  privacy: ShieldCheck,
  system: Cpu
}

/**
 * Sections whose runtime feature is not built yet. A section appearing here is
 * badged "coming soon" in the rail so the UI never pretends a feature exists.
 * Remove a key when its milestone ships.
 */
const SECTION_COMING_SOON = new Set<SettingsSection>(['voice', 'prompts', 'announcements'])

/** A single settings row: description on the left, control on the right. */
function Row({
  label,
  hint,
  control,
  stacked
}: {
  label: string
  hint?: ReactNode
  control: ReactNode
  stacked?: boolean
}): ReactNode {
  return (
    <div className={stacked ? 'settings__field settings__field--stacked' : 'settings__field'}>
      <div>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>{label}</div>
        {hint ? (
          <div className="field__hint" style={{ marginTop: 2 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div>{control}</div>
    </div>
  )
}

/**
 * Text/number input that keeps a local draft and only commits on blur or
 * Enter, so typing never triggers a settings write on every keystroke.
 */
function DraftInput({
  value,
  onCommit,
  type = 'text',
  placeholder
}: {
  value: string | number
  onCommit: (value: string) => void
  type?: 'text' | 'number'
  placeholder?: string
}): ReactNode {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    if (draft !== String(value)) onCommit(draft)
  }

  return (
    <input
      className="input"
      type={type}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

/** Dropdown of curated monospace families with a live preview. */
function FontPicker({
  value,
  onChange
}: {
  value: string
  onChange: (stack: string) => void
}): ReactNode {
  const known = findTerminalFont(value)

  return (
    <div className="font-picker">
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {TERMINAL_FONTS.map((font) => (
          <option key={font.id} value={font.stack}>
            {font.label}
          </option>
        ))}
        {!known ? <option value={value}>Custom stack</option> : null}
      </select>
      <div className="font-picker__preview" style={{ fontFamily: value }} aria-hidden="true">
        <span>λ → git status --short</span>
        <span className="font-picker__preview-dim">The quick brown fox 0123456789</span>
      </div>
      <div className="field__hint">{known ? known.note : 'Using a custom font stack.'}</div>
    </div>
  )
}

function SecretRow({
  slot,
  label,
  present,
  onSave,
  onClear
}: {
  slot: SecretSlot
  label: string
  present: boolean
  onSave: (slot: string, value: string) => Promise<void>
  onClear: (slot: string) => Promise<void>
}): ReactNode {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <Row
      label={label}
      hint={
        present ? (
          <span className="row" style={{ gap: 6 }}>
            <ShieldCheck size={12} style={{ color: 'var(--success)' }} />
            A credential is stored (encrypted locally, never shown again).
          </span>
        ) : (
          'No credential stored.'
        )
      }
      control={
        <div className="row">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={present ? '••••••••' : 'Paste key'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            className="btn"
            disabled={saving || value.trim().length === 0}
            onClick={() => {
              setSaving(true)
              void onSave(slot, value).finally(() => {
                setValue('')
                setSaving(false)
              })
            }}
          >
            Store
          </button>
          {present ? (
            <button className="btn btn--danger" disabled={saving} onClick={() => void onClear(slot)}>
              Clear
            </button>
          ) : null}
        </div>
      }
    />
  )
}

export function SettingsPage(): ReactNode {
  const { state, actions } = useApp()
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [query, setQuery] = useState('')
  const settings = state.settings

  const visibleSections = useMemo(() => {
    if (!query.trim()) return SETTINGS_SECTIONS
    const needle = query.trim().toLowerCase()
    return SETTINGS_SECTIONS.filter((key) => SECTION_LABELS[key].toLowerCase().includes(needle))
  }, [query])

  if (!settings) {
    return (
      <div className="page">
        <header className="page__header">
          <h1 className="page__title">Settings</h1>
        </header>
        <div className="page__body">
          <p className="muted">Loading settings…</p>
        </div>
      </div>
    )
  }

  const update = (patch: Partial<Settings>): void => void actions.updateSettings(patch)
  const appearance = (patch: Partial<Settings['appearance']>): void =>
    update({ appearance: patch as Settings['appearance'] })
  const terminal = (patch: Partial<Settings['terminal']>): void => update({ terminal: patch as Settings['terminal'] })
  const voice = (patch: Partial<Settings['voice']>): void => update({ voice: patch as Settings['voice'] })
  const prompts = (patch: Partial<Settings['prompts']>): void => update({ prompts: patch as Settings['prompts'] })
  const announcements = (patch: Partial<Settings['announcements']>): void =>
    update({ announcements: patch as Settings['announcements'] })
  const privacy = (patch: Partial<Settings['privacy']>): void => update({ privacy: patch as Settings['privacy'] })

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings sections">
        <div className="settings__nav-head">
          <span className="settings__nav-title">Settings</span>
          <span className="settings__nav-caption">Changes save automatically</span>
        </div>
        <div className="settings__search">
          <input
            className="input"
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="settings__links">
          {visibleSections.map((key) => {
            const Icon = SECTION_ICONS[key]
            const isActive = key === section
            return (
              <button
                key={key}
                type="button"
                className={isActive ? 'settings__link settings__link--active' : 'settings__link'}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setSection(key)}
              >
                <Icon size={15} />
                {SECTION_LABELS[key]}
                {SECTION_COMING_SOON.has(key) ? <span className="settings__soon">soon</span> : null}
              </button>
            )
          })}
          {visibleSections.length === 0 ? <span className="settings__empty">No matches</span> : null}
        </div>
        <div className="settings__note">VoxTerm {state.system?.appVersion ?? '—'}</div>
      </nav>

      <div className="settings__content">
        <div className="settings__section">
          {section === 'appearance' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">Appearance</h2>
                <p className="settings__section-desc">Typography, colour and motion for the whole application.</p>
              </div>
              <div className="settings__group">
                <Row
                  label="Theme"
                  hint="Two deep-black palettes tuned for long sessions."
                  control={
                    <select
                      className="select"
                      value={settings.appearance.theme}
                      onChange={(event) =>
                        appearance({ theme: event.target.value as Settings['appearance']['theme'] })
                      }
                    >
                      <option value="voxterm">VoxTerm</option>
                      <option value="voxterm-contrast">VoxTerm contrast</option>
                    </select>
                  }
                />
                <Row
                  label="Terminal font"
                  hint="Choose the typeface used inside every terminal."
                  stacked
                  control={
                    <FontPicker
                      value={settings.appearance.terminalFontFamily}
                      onChange={(stack) => appearance({ terminalFontFamily: stack })}
                    />
                  }
                />
                <Row
                  label="Terminal font size"
                  hint={`${settings.appearance.terminalFontSize}px`}
                  control={
                    <input
                      type="range"
                      min={8}
                      max={32}
                      step={1}
                      value={settings.appearance.terminalFontSize}
                      onChange={(event) => appearance({ terminalFontSize: Number(event.target.value) })}
                    />
                  }
                />
                <Row
                  label="Line height"
                  hint={settings.appearance.terminalLineHeight.toFixed(2)}
                  control={
                    <input
                      type="range"
                      min={1}
                      max={2.5}
                      step={0.05}
                      value={settings.appearance.terminalLineHeight}
                      onChange={(event) => appearance({ terminalLineHeight: Number(event.target.value) })}
                    />
                  }
                />
                <Row
                  label="Cursor style"
                  control={
                    <select
                      className="select"
                      value={settings.appearance.cursorStyle}
                      onChange={(event) =>
                        appearance({ cursorStyle: event.target.value as Settings['appearance']['cursorStyle'] })
                      }
                    >
                      <option value="block">Block</option>
                      <option value="underline">Underline</option>
                      <option value="bar">Bar</option>
                    </select>
                  }
                />
                <Row
                  label="Blinking cursor"
                  control={
                    <Switch
                      label=""
                      checked={settings.appearance.cursorBlink}
                      onChange={(value) => appearance({ cursorBlink: value })}
                    />
                  }
                />
                <Row
                  label="Interface density"
                  control={
                    <select
                      className="select"
                      value={settings.appearance.interfaceDensity}
                      onChange={(event) =>
                        appearance({
                          interfaceDensity: event.target.value as Settings['appearance']['interfaceDensity']
                        })
                      }
                    >
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </select>
                  }
                />
                <Row
                  label="Animation intensity"
                  hint={
                    settings.appearance.reducedMotion
                      ? 'Reduce motion is on — this setting is inactive.'
                      : undefined
                  }
                  control={
                    <select
                      className="select"
                      value={settings.appearance.animationIntensity}
                      disabled={settings.appearance.reducedMotion}
                      onChange={(event) =>
                        appearance({
                          animationIntensity: event.target.value as Settings['appearance']['animationIntensity']
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="subtle">Subtle</option>
                      <option value="full">Full</option>
                    </select>
                  }
                />
                <Row
                  label="Reduce motion"
                  hint="Disables transitions and smooth scrolling."
                  control={
                    <Switch
                      label=""
                      checked={settings.appearance.reducedMotion}
                      onChange={(value) => appearance({ reducedMotion: value })}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'terminal' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">Terminal</h2>
                <p className="settings__section-desc">How shells are started and how sessions behave.</p>
              </div>
              <div className="settings__group">
                <Row
                  label="Default shell"
                  hint={
                    <>
                      Leave blank to auto-detect. Detected:{' '}
                      {state.system?.shells.filter((shell) => shell.available).map((shell) => shell.name).join(', ') ||
                        'checking…'}
                    </>
                  }
                  control={
                    <DraftInput
                      value={settings.terminal.defaultShell}
                      placeholder="auto-detect"
                      onCommit={(value) => terminal({ defaultShell: value.trim() })}
                    />
                  }
                />
                <Row
                  label="Startup directory"
                  hint="Leave blank to start in your home directory."
                  control={
                    <DraftInput
                      value={settings.terminal.startupDirectory}
                      placeholder="~"
                      onCommit={(value) => terminal({ startupDirectory: value.trim() })}
                    />
                  }
                />
                <Row
                  label="New terminal directory"
                  control={
                    <select
                      className="select"
                      value={settings.terminal.newTerminalBehavior}
                      onChange={(event) =>
                        terminal({
                          newTerminalBehavior: event.target.value as Settings['terminal']['newTerminalBehavior']
                        })
                      }
                    >
                      <option value="home">Home directory</option>
                      <option value="active-session-cwd">Active session directory</option>
                      <option value="configured">Configured startup directory</option>
                    </select>
                  }
                />
                <Row
                  label="Scrollback lines"
                  control={
                    <DraftInput
                      type="number"
                      value={settings.terminal.scrollback}
                      onCommit={(value) => {
                        const parsed = Number(value)
                        if (Number.isFinite(parsed)) terminal({ scrollback: Math.floor(parsed) })
                      }}
                    />
                  }
                />
                <Row
                  label="Confirm before terminating a session"
                  control={
                    <Switch
                      label=""
                      checked={settings.terminal.confirmBeforeTerminate}
                      onChange={(value) => terminal({ confirmBeforeTerminate: value })}
                    />
                  }
                />
                <Row
                  label="Confirm before closing the app"
                  hint="Only prompts when sessions are still running."
                  control={
                    <Switch
                      label=""
                      checked={settings.terminal.confirmBeforeAppClose}
                      onChange={(value) => terminal({ confirmBeforeAppClose: value })}
                    />
                  }
                />
                <Row
                  label="Copy on select"
                  control={
                    <Switch
                      label=""
                      checked={settings.terminal.copyOnSelect}
                      onChange={(value) => terminal({ copyOnSelect: value })}
                    />
                  }
                />
                <Row
                  label="Right-click paste"
                  control={
                    <Switch
                      label=""
                      checked={settings.terminal.rightClickPaste}
                      onChange={(value) => terminal({ rightClickPaste: value })}
                    />
                  }
                />
                <Row
                  label="Detect clickable links"
                  control={
                    <Switch
                      label=""
                      checked={settings.terminal.detectLinks}
                      onChange={(value) => terminal({ detectLinks: value })}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'voice' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">
                  Voice
                  {SECTION_COMING_SOON.has('voice') ? <span className="settings__soon">coming soon</span> : null}
                </h2>
                <p className="settings__section-desc">Speech input and local transcription preferences.</p>
              </div>
              <Notice tone="warning" icon={<ShieldCheck size={15} />}>
                The voice runtime is not implemented in this build. These values are stored now and will apply
                when the microphone pipeline ships.
              </Notice>
              <div className="settings__group">
                <Row
                  label="Enable voice input"
                  control={
                    <Switch
                      label=""
                      checked={settings.voice.enabled}
                      onChange={(value) => voice({ enabled: value })}
                    />
                  }
                />
                <Row
                  label="Push-to-talk hotkey"
                  hint="Letters, digits, + and - only (e.g. Ctrl+Alt+Space)."
                  control={
                    <DraftInput
                      value={settings.voice.hotkey}
                      onCommit={(value) => {
                        if (/^[A-Za-z0-9+ -]*$/.test(value)) voice({ hotkey: value })
                      }}
                    />
                  }
                />
                <Row
                  label="Push-to-talk"
                  hint="Hold the hotkey to record; release to transcribe."
                  control={
                    <Switch
                      label=""
                      checked={settings.voice.pushToTalk}
                      onChange={(value) => voice({ pushToTalk: value })}
                    />
                  }
                />
                <Row
                  label="Transcription provider"
                  control={
                    <select
                      className="select"
                      value={settings.voice.transcriptionProvider}
                      onChange={(event) =>
                        voice({
                          transcriptionProvider: event.target
                            .value as Settings['voice']['transcriptionProvider']
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="whisper-local">Whisper (local)</option>
                    </select>
                  }
                />
                <Row
                  label="Whisper model path"
                  control={
                    <DraftInput
                      value={settings.voice.whisperModelPath}
                      placeholder="/path/to/model.bin"
                      onCommit={(value) => voice({ whisperModelPath: value.trim() })}
                    />
                  }
                />
                <Row
                  label="Language"
                  hint="Use “auto” for automatic detection."
                  control={
                    <DraftInput
                      value={settings.voice.language}
                      onCommit={(value) => voice({ language: value.trim() || 'auto' })}
                    />
                  }
                />
                <Row
                  label="Review transcription before sending"
                  control={
                    <Switch
                      label=""
                      checked={settings.voice.reviewBeforeSend}
                      onChange={(value) => voice({ reviewBeforeSend: value })}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'prompts' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">
                  Prompt providers
                  {SECTION_COMING_SOON.has('prompts') ? <span className="settings__soon">coming soon</span> : null}
                </h2>
                <p className="settings__section-desc">
                  Where natural-language prompts may be sent. Local-only is the safe default.
                </p>
              </div>
              <Notice tone="warning" icon={<ShieldCheck size={15} />}>
                Prompt generation is part of a later milestone. Provider settings are stored now; no requests
                are made by this build.
              </Notice>
              <div className="settings__group">
                <Row
                  label="Local-only mode"
                  hint="Prevents any prompt from leaving the machine."
                  control={
                    <Switch
                      label=""
                      checked={settings.prompts.localOnly}
                      onChange={(value) => prompts({ localOnly: value })}
                    />
                  }
                />
                <Row
                  label="Ollama"
                  hint="Local model server."
                  control={
                    <Switch
                      label=""
                      checked={settings.prompts.ollama.enabled}
                      onChange={(value) => prompts({ ollama: { ...settings.prompts.ollama, enabled: value } })}
                    />
                  }
                />
                <Row
                  label="Ollama base URL"
                  control={
                    <DraftInput
                      value={settings.prompts.ollama.baseUrl}
                      onCommit={(value) => prompts({ ollama: { ...settings.prompts.ollama, baseUrl: value.trim() } })}
                    />
                  }
                />
                <Row
                  label="OpenRouter"
                  hint="Requires a stored credential."
                  control={
                    <Switch
                      label=""
                      checked={settings.prompts.openrouter.enabled}
                      disabled={!state.secrets.openrouter}
                      onChange={(value) =>
                        prompts({ openrouter: { ...settings.prompts.openrouter, enabled: value } })
                      }
                    />
                  }
                />
                <Row
                  label="Google"
                  control={
                    <Switch
                      label=""
                      checked={settings.prompts.google.enabled}
                      disabled={!state.secrets.google}
                      onChange={(value) => prompts({ google: { ...settings.prompts.google, enabled: value } })}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'announcements' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">
                  Announcements
                  {SECTION_COMING_SOON.has('announcements') ? (
                    <span className="settings__soon">coming soon</span>
                  ) : null}
                </h2>
                <p className="settings__section-desc">Spoken notifications for terminal events.</p>
              </div>
              <Notice tone="warning" icon={<ShieldCheck size={15} />}>
                Speech synthesis is part of a later milestone and is inactive in this build.
              </Notice>
              <div className="settings__group">
                <Row
                  label="Enable announcements"
                  control={
                    <Switch
                      label=""
                      checked={settings.announcements.enabled}
                      onChange={(value) => announcements({ enabled: value })}
                    />
                  }
                />
                <Row
                  label="Volume"
                  hint={`${Math.round(settings.announcements.volume * 100)}%`}
                  control={
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.announcements.volume}
                      onChange={(event) => announcements({ volume: Number(event.target.value) })}
                    />
                  }
                />
                <Row
                  label="Speaking rate"
                  hint={`${settings.announcements.rate.toFixed(2)}×`}
                  control={
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={settings.announcements.rate}
                      onChange={(event) => announcements({ rate: Number(event.target.value) })}
                    />
                  }
                />
                <Row
                  label="Announce events"
                  stacked
                  control={
                    <div className="chip-row">
                      {(['session-exit', 'build-finished', 'error', 'agent-event'] as const).map((kind) => {
                        const selected = settings.announcements.eventCategories.includes(kind)
                        return (
                          <button
                            key={kind}
                            className={selected ? 'chip chip--active' : 'chip'}
                            onClick={() => {
                              const next = selected
                                ? settings.announcements.eventCategories.filter((item) => item !== kind)
                                : [...settings.announcements.eventCategories, kind]
                              announcements({ eventCategories: next })
                            }}
                          >
                            {kind}
                          </button>
                        )
                      })}
                    </div>
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'privacy' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">Privacy</h2>
                <p className="settings__section-desc">What VoxTerm stores and what it may record.</p>
              </div>
              <div className="settings__group">
                <Row
                  label="Local-only mode"
                  hint="Disables any outbound provider calls."
                  control={
                    <Switch
                      label=""
                      checked={settings.privacy.localOnlyMode}
                      onChange={(value) => privacy({ localOnlyMode: value })}
                    />
                  }
                />
                <Row
                  label="Diagnostic logging"
                  hint="Writes application logs to disk for troubleshooting."
                  control={
                    <Switch
                      label=""
                      checked={settings.privacy.diagnosticLogging}
                      onChange={(value) => privacy({ diagnosticLogging: value })}
                    />
                  }
                />
                <Row
                  label="Redact logs"
                  hint="Strips paths and identifiers from log output."
                  control={
                    <Switch
                      label=""
                      checked={settings.privacy.redactLogs}
                      onChange={(value) => privacy({ redactLogs: value })}
                    />
                  }
                />
                <Row
                  label="Log terminal output"
                  hint="Off by default. Terminal output may contain secrets; enabling this writes it to disk."
                  control={
                    <Switch
                      label=""
                      checked={settings.privacy.logTerminalOutput}
                      onChange={(value) => privacy({ logTerminalOutput: value })}
                    />
                  }
                />
                <Row
                  label="On exit"
                  control={
                    <select
                      className="select"
                      value={settings.privacy.sessionCleanupOnExit}
                      onChange={(event) =>
                        privacy({
                          sessionCleanupOnExit: event.target
                            .value as Settings['privacy']['sessionCleanupOnExit']
                        })
                      }
                    >
                      <option value="ask">Ask each time</option>
                      <option value="terminate-managed">Terminate shells on exit</option>
                      <option value="keep-managed">Keep shells running</option>
                    </select>
                  }
                />
                <Row
                  label="Activity retention"
                  hint={`Keep the most recent ${settings.privacy.activityRetention} events.`}
                  control={
                    <DraftInput
                      type="number"
                      value={settings.privacy.activityRetention}
                      onCommit={(value) => {
                        const parsed = Number(value)
                        if (Number.isFinite(parsed)) privacy({ activityRetention: Math.floor(parsed) })
                      }}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {section === 'system' ? (
            <>
              <div className="settings__section-head">
                <h2 className="settings__section-title">System &amp; credentials</h2>
                <p className="settings__section-desc">Runtime information and stored API credentials.</p>
              </div>

              <div className="settings__group">
                <div className="section-title">Runtime</div>
                <div className="kv">
                  <span className="kv__key">VoxTerm</span>
                  <span className="kv__value">{state.system?.appVersion ?? '—'}</span>
                  <span className="kv__key">Electron</span>
                  <span className="kv__value">{state.system?.electron ?? '—'}</span>
                  <span className="kv__key">Chrome</span>
                  <span className="kv__value">{state.system?.chrome ?? '—'}</span>
                  <span className="kv__key">Node</span>
                  <span className="kv__value">{state.system?.node ?? '—'}</span>
                  <span className="kv__key">V8</span>
                  <span className="kv__value">{state.system?.v8 ?? '—'}</span>
                  <span className="kv__key">Platform</span>
                  <span className="kv__value">
                    {state.system ? `${state.system.platform} · ${state.system.arch} · ${state.system.osRelease}` : '—'}
                  </span>
                  <span className="kv__key">Default shell</span>
                  <span className="kv__value">
                    {state.system ? shortenPath(state.system.defaultShell) || state.system.defaultShell : '—'}
                  </span>
                  <span className="kv__key">node-pty</span>
                  <span className="kv__value">
                    {state.system?.terminalBackend.nodePty
                      ? `ok${state.system.terminalBackend.ptyVersion ? ` (${state.system.terminalBackend.ptyVersion})` : ''}`
                      : state.system?.terminalBackend.error ?? 'unavailable'}
                  </span>
                </div>
              </div>

              <div className="settings__group">
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <KeyRound size={15} className="muted" />
                  <span className="section-title">Credentials</span>
                </div>
                <p className="field__hint">
                  Credentials are encrypted on disk and never returned to the interface or written to logs.
                </p>
                <SecretRow
                  slot="openrouter"
                  label="OpenRouter API key"
                  present={state.secrets.openrouter}
                  onSave={actions.setSecret}
                  onClear={actions.clearSecret}
                />
                <SecretRow
                  slot="google"
                  label="Google API key"
                  present={state.secrets.google}
                  onSave={actions.setSecret}
                  onClear={actions.clearSecret}
                />
                <SecretRow
                  slot="elevenlabs"
                  label="ElevenLabs API key"
                  present={state.secrets.elevenlabs}
                  onSave={actions.setSecret}
                  onClear={actions.clearSecret}
                />
              </div>

              <div className="settings__group">
                <div className="row row--between">
                  <div>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Reset all settings</div>
                    <div className="field__hint">Restores every preference to its default value.</div>
                  </div>
                  <button className="btn btn--danger" onClick={() => void actions.resetSettings()}>
                    <RotateCcw size={14} />
                    Reset
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
