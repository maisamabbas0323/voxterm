import { type ReactNode } from 'react'
import { AudioLines, Keyboard, Mic, Settings2, Terminal, Waves } from 'lucide-react'
import { useApp } from '../state/store'
import { Notice, Pill } from '../components/primitives'
import { shortenPath } from '../lib/format'

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
          Voice capture, transcription and announcements are <strong>not active in this build</strong>. This
          milestone delivers the Electron foundation, real terminal sessions and the integration architecture.
          The microphone pipeline (push-to-talk, local Whisper transcription, prompt review before send) is
          scheduled for a later milestone. Preferences below are stored now and will apply once the runtime
          ships.
        </Notice>

        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Configuration</span>
            <Pill tone={settings?.voice.enabled ? 'success' : 'neutral'}>
              {settings?.voice.enabled ? 'enabled' : 'disabled'}
            </Pill>
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

        <div className="row" style={{ alignItems: 'stretch', gap: 'var(--space-4)' }}>
          <div className="panel grow">
            <div className="panel__header">
              <span className="panel__title">Local transcription</span>
              <Waves size={15} className="muted" />
            </div>
            <div className="panel__body stack stack--sm">
              <div className="row">
                <span className="muted">Whisper binary</span>
                <span className="grow" />
                <Pill tone={whisper?.binaryPath ? 'success' : 'neutral'}>
                  {whisper?.binaryPath ? 'found' : 'not found'}
                </Pill>
              </div>
              <div className="row">
                <span className="muted">Model file</span>
                <span className="grow" />
                <Pill tone={whisper?.modelPresent ? 'success' : 'neutral'}>
                  {whisper?.modelPresent ? 'present' : 'missing'}
                </Pill>
              </div>
              <p className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
                Transcription runs locally by default so terminal content never leaves the machine unless a
                cloud provider is explicitly enabled in Settings.
              </p>
            </div>
          </div>

          <div className="panel grow">
            <div className="panel__header">
              <span className="panel__title">Data flow (planned)</span>
              <AudioLines size={15} className="muted" />
            </div>
            <div className="panel__body stack stack--sm">
              <div className="row">
                <Keyboard size={14} className="muted" />
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Hotkey pressed → microphone capture begins
                </span>
              </div>
              <div className="row">
                <Mic size={14} className="muted" />
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Local transcription produces a text prompt
                </span>
              </div>
              <div className="row">
                <Terminal size={14} className="muted" />
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Review, then send to the active terminal session
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
