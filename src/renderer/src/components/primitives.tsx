import type { ReactNode } from 'react'

export type DotState = 'running' | 'starting' | 'exited'

export function statusDotClass(state: DotState): string {
  switch (state) {
    case 'running':
      return 'dot dot--running'
    case 'starting':
      return 'dot dot--starting'
    case 'exited':
    default:
      return 'dot dot--exited'
  }
}

export function StatusDot({ state, title }: { state: DotState; title?: string }): ReactNode {
  return <span className={statusDotClass(state)} title={title} aria-hidden="true" />
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  htmlFor?: string
}): ReactNode {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="field__error">{error}</span> : null}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}): ReactNode {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      <p className="empty__text">{text}</p>
      {action}
    </div>
  )
}

export function Notice({
  tone = 'info',
  icon,
  children
}: {
  tone?: 'info' | 'warning'
  icon: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__icon">{icon}</span>
      <div>{children}</div>
    </div>
  )
}
