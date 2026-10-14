import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
  dismissOnBackdrop?: boolean
}

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  wide,
  dismissOnBackdrop = true
}: ModalProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    // Move focus into the dialog for keyboard users.
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={wide ? 'modal modal--wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <header className="modal__header">
          <div className="row row--between">
            <h2 className="modal__title">{title}</h2>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close dialog">
              <X size={15} />
            </button>
          </div>
          {description ? <p className="modal__desc">{description}</p> : null}
        </header>
        {children ? <div className="modal__body">{children}</div> : null}
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  )
}
