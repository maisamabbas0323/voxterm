import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export interface ToastRecord {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
}

const ICONS: Record<ToastRecord['tone'], ReactNode> = {
  info: <Info size={15} className="muted" />,
  success: <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />,
  error: <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
}

function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }): ReactNode {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.tone === 'error' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.tone, onDismiss])

  return (
    <div className={`toast toast--${toast.tone}`} role="status">
      <span style={{ marginTop: 1 }}>{ICONS[toast.tone]}</span>
      <span className="grow">{toast.message}</span>
      <button className="btn btn--ghost btn--icon btn--sm" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  )
}

export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}): ReactNode {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
