import type { ReactNode } from 'react'
import { AudioLines, Check, FileText, Keyboard, Mic, MicOff, Settings2, Terminal, Waves } from 'lucide-react'
import { useApp } from '../state/store'
import { shortenPath } from '../lib/format'

type Readiness = 'ready' | 'missing' | 'unknown'

function StatusLine({ ready, label, detail }: { ready: Readiness; label: string; detail?: string }): ReactNode {
  const tone = ready === 'ready' ? 'success' : ready === 'missing' ? 'muted' : 'muted'
  return (
    <div className="row row--between" style={{ minHeight: 24 }}>
      <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
        {ready === 'ready' ? (
          <Check size={13} style={{ color: 'var(--success)' }} aria-hidden="true" />
        ) : (
          <span className="dot dot--exited" aria-hidden="true" />
        )}
        <span className="truncate" style={{ fontSize: 'var(--fs-sm)' }}>
          {label}
        </span>
      </span>
      <span
        className="truncate"
        title={detail}
        style={{ fontSize: 'var(--fs-xs)', color: `var(--${tone === 'success' ? 'success' : 'text-muted'})` }}
      >
        {detail ?? (ready === 'ready' ? 'ready' : 'missing')}
      </span>
    </div>
  )
}

const STEPS: Array<{ icon: ReactNode; title: string; text: string; active: boolean }> = [
  {
    icon: <Mic size={14} />,
    title: 'Capture',
    text: 'Hold the push-to-talk hotkey to record microphone audio locally.',
    active: false
  },
  {
    icon: <Waves size={14} />,
    title: 'Transcribe',
    text: 'A local whisper.cpp HTTP server turns the recording into text.',
    active: false
  },
  {
    icon: <FileText size={14} />,
    title: 'Review',
    text: 'The transcript appears in an editable box before anything is sent.',
    active: false
  },
  {
    icon: <Terminal size={14} />,
    title: 'Send',
    text: 'Approved text is pasted into the selected terminal tab; Enter is yours.',
    active: false
  }
]

export function VoicePage(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings
  const whisper = state.system?.whisper
  const binary = whisper?.binaryPath ?? null
  const modelPresent = whisper?.modelPresent === true
  const runtimeReady = Boolean(binary) && modelPresent
  const enabled = settings?.voice.enabled === true

  const overall: { label: string; tone: 'off' | 'warn' | 'ok'; detail: string } = !enabled
    ? { label: 'Voice input is off', tone: 'off', detail: 'Enable it in Settings → Voice to start the pipeline.' }
    : !runtimeReady
      ? {
          label: 'Whisper runtime not ready',
          tone: 'warn',
          detail: !binary
            ? 'The whisper-server binary was not found on PATH.'
            : 'A GGML model file is configured but not present on disk.'
        }
      : { label: 'Ready for capture', tone: 'ok', detail: 'Hotkey and model are configured.' }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Voice</h1>
          <p className="page__subtitle">Offline speech input for your terminals — nothing leaves this machine.</p>
        </div>
        <div className="page__actions">
          <button className="btn" onClick={() => actions.navigate('settings')}>
            <Settings2 size={14} />
            Configure
          </button>
        </div>
      </header>

      <div className="page__body stack">
        {/* Hero: one honest status, no decorative animation. */}
        <div className="panel voice-hero">
          <div className="voice-hero__icon" aria-hidden="true">
            {overall.tone === 'ok' ? <Mic size={22} /> : <MicOff size={22} />}
          </div>
          <div className="grow">
            <div className="voice-hero__title">{overall.label}</div>
            <div className="voice-hero__detail">{overall.detail}</div>
          </div>
          <span
            className={`stat-pill stat-pill--${
              overall.tone === 'ok' ? 'ok' : overall.tone === 'warn' ? 'warn' : 'off'
            }`}
          >
            {enabled ? 'enabled' : 'disabled'}
          </span>
        </div>

        {!enabled ? (
          <div className="row" style={{ gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            <Keyboard size={14} aria-hidden="true" />
            Flip “Enable voice input” in Settings → Voice when you want the pipeline wired in.
          </div>
        ) : null}

        {/* Diagnostics reflect real system checks only. */}
        <div className="split">
          <div className="panel">
            <div className="panel__header">
              <div className="col">
                <span className="panel__title">Runtime diagnostics</span>
                <span className="panel__caption">Checked against the real filesystem and PATH.</span>
              </div>
              <Waves size={15} className="muted" />
            </div>
            <div className="panel__body stack stack--sm">
              <StatusLine
                ready={binary ? 'ready' : 'missing'}
                label="whisper-server binary"
                detail={binary ? shortenPath(binary) : undefined}
              />
              <StatusLine
                ready={modelPresent ? 'ready' : 'missing'}
                label="GGML model file"
                detail={
                  settings?.voice.whisperModelPath
                    ? shortenPath(settings.voice.whisperModelPath)
                    : 'no path configured'
                }
              />
              <StatusLine
                ready="unknown"
                label="Microphone access"
                detail="checked at first capture"
              />
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <div className="col">
                <span className="panel__title">Configuration in use</span>
                <span className="panel__caption">Saved preferences that govern the pipeline.</span>
              </div>
              <Settings2 size={15} className="muted" />
            </div>
            <div className="panel__body">
              <div className="kv">
                <span className="kv__key">Hotkey</span>
                <span className="kv__value">{settings?.voice.hotkey ?? '—'}</span>
                <span className="kv__key">Mode</span>
                <span className="kv__value">{settings?.voice.pushToTalk ? 'Push to talk' : 'Toggle'}</span>
                <span className="kv__key">Language</span>
                <span className="kv__value">{settings?.voice.language ?? 'auto'}</span>
                <span className="kv__key">Review first</span>
                <span className="kv__value">{settings?.voice.reviewBeforeSend ? 'yes' : 'no'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* The workflow, presented as one sequence. */}
        <div className="panel">
          <div className="panel__header">
            <div className="col">
              <span className="panel__title">How a spoken prompt reaches the terminal</span>
              <span className="panel__caption">Four steps, each gated by a real capability.</span>
            </div>
            <AudioLines size={15} className="muted" />
          </div>
          <div className="panel__body">
            <ol className="steps">
              {STEPS.map((step, index) => (
                <li className="steps__item" key={step.title}>
                  <span className="steps__index">{index + 1}</span>
                  <span className="steps__icon" aria-hidden="true">
                    {step.icon}
                  </span>
                  <span className="steps__text">
                    <strong>{step.title}</strong> — {step.text}
                  </span>
                </li>
              ))}
            </ol>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.5, marginTop: 'var(--space-3)' }}>
              The capture → transcription → review pipeline is not active in this build; preferences are
              stored and will apply once the runtime ships. Terminal content never leaves the machine unless
              a cloud provider is explicitly enabled in Settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
