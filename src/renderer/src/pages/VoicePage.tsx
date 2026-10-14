import { type ReactNode } from 'react'
import { AudioLines, Keyboard, Mic, Settings2, Terminal, Waves } from 'lucide-react'
import { useApp } from '../state/store'
import { Notice } from '../components/primitives'
import { shortenPath } from '../lib/format'

function StatusLine({ ready, label }: { ready: boolean; label: string }): ReactNode {
  return (
    <div className="row row--between">
      <span className="muted">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <span className={ready ? 'dot dot--running' : 'dot dot--exited'} aria-hidden="true" />
        <span style={{ fontSize: 'var(--fs-xs)', color: ready ? 'var(--success)' : 'var(--text-muted)' }}>
          {ready ? 'ready' : 'missing'}
        </span>
      </span>
    </div>
  )
}

const FLOW_STEPS: Array<{ icon: ReactNode; text: string }> = [
  { icon: <Keyboard size={14} />, text: 'Press the push-to-talk hotkey to begin capturing audio.' },
  { icon: <Mic size={14} />, text: 'Local Whisper transcription turns your speech into a text prompt.' },
  { icon: <Terminal size={14} />, text: 'Review the prompt, then send it to the active terminal session.' }
]

export function VoicePage(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings
  const whisper = state.system?.whisper

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Voice</h1>
          <p className="page__subtitle">Speech input and spoken announcements for terminal workflows.</p>
        </div>
        <div className="page__actions">
          <button className="btn" onClick={() => actions.navigate('settings')}>
            <Settings2 size={14} />
            Configure
          </button>
        </div>
      </header>

      <div className="page__body stack">
        <Notice tone="info" icon={<Mic size={16} />}>
          Voice capture, transcription and announcements are <strong>not active in this build</strong>. The
          microphone pipeline — push-to-talk, local Whisper transcription and prompt review — ships in a later
          milestone. The preferences below are stored now and will apply once the runtime arrives.
        </Notice>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat__label">Voice input</span>
            <span className="stat__value">{settings?.voice.enabled ? 'Enabled' : 'Disabled'}</span>
            <span className="stat__meta">
              {settings?.voice.pushToTalk ? 'Push-to-talk' : 'Toggle mode'} · stored preference
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Hotkey</span>
            <span className="stat__value stat__value--mono">{settings?.voice.hotkey ?? '—'}</span>
            <span className="stat__meta">Bound once the capture runtime ships</span>
          </div>
          <div className="stat">
            <span className="stat__label">Transcription</span>
            <span className="stat__value">{settings?.voice.transcriptionProvider ?? 'none'}</span>
            <span className="stat__meta">
              {settings?.voice.whisperModelPath ? 'Local model configured' : 'No local model configured'}
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div className="col">
              <span className="panel__title">Configuration</span>
              <span className="panel__caption">Stored preferences for the voice workflow.</span>
            </div>
            <span className="row" style={{ gap: 6 }}>
              <span
                className={settings?.voice.enabled ? 'dot dot--running' : 'dot dot--exited'}
                aria-hidden="true"
              />
              <span className="panel__caption">{settings?.voice.enabled ? 'enabled' : 'disabled'}</span>
            </span>
          </div>
          <div className="panel__body">
            <div className="kv">
              <span className="kv__key">Push-to-talk hotkey</span>
              <span className="kv__value">{settings?.voice.hotkey ?? '—'}</span>
              <span className="kv__key">Mode</span>
              <span className="kv__value">{settings?.voice.pushToTalk ? 'Push to talk' : 'Toggle'}</span>
              <span className="kv__key">Transcription provider</span>
              <span className="kv__value">{settings?.voice.transcriptionProvider ?? 'none'}</span>
              <span className="kv__key">Whisper model</span>
              <span className="kv__value">
                {settings?.voice.whisperModelPath
                  ? shortenPath(settings.voice.whisperModelPath)
                  : 'not configured'}
              </span>
              <span className="kv__key">Language</span>
              <span className="kv__value">{settings?.voice.language ?? 'auto'}</span>
            </div>
          </div>
        </div>

        <div className="split">
          <div className="panel">
            <div className="panel__header">
              <div className="col">
                <span className="panel__title">Local transcription</span>
                <span className="panel__caption">Everything runs on this machine by default.</span>
              </div>
              <Waves size={15} className="muted" />
            </div>
            <div className="panel__body stack stack--sm">
              <StatusLine ready={Boolean(whisper?.binaryPath)} label="Whisper binary" />
              <StatusLine ready={Boolean(whisper?.modelPresent)} label="Model file" />
              <p className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
                Terminal content never leaves the machine unless a cloud provider is explicitly enabled in
                Settings.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <div className="col">
                <span className="panel__title">Planned flow</span>
                <span className="panel__caption">How voice input will reach your terminal.</span>
              </div>
              <AudioLines size={15} className="muted" />
            </div>
            <div className="panel__body">
              <ol className="steps">
                {FLOW_STEPS.map((step, index) => (
                  <li className="steps__item" key={index}>
                    <span className="steps__index">{index + 1}</span>
                    <span className="steps__icon" aria-hidden="true">
                      {step.icon}
                    </span>
                    <span className="steps__text">{step.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
