import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  label: string
  children: ReactNode
  placement?: 'top' | 'bottom'
  /** Only show when the label adds information (defaults to true). */
  disabled?: boolean
}

/**
 * Accessible, portal-rendered tooltip. Shows on hover and keyboard focus and
 * is anchored to the trigger element, so it never blocks clicks.
 */
export function Tooltip({ label, children, placement = 'bottom', disabled }: TooltipProps): ReactNode {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const show = useCallback(() => {
    const node = anchorRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8
    setCoords({ top, left: rect.left + rect.width / 2 })
  }, [placement])

  const hide = useCallback(() => setCoords(null), [])

  return (
    <span
      className="tooltip-anchor"
      ref={anchorRef}
      onMouseEnter={disabled ? undefined : show}
      onMouseLeave={hide}
      onFocus={disabled ? undefined : show}
      onBlur={hide}
    >
      {children}
      {coords && !disabled
        ? createPortal(
            <span
              className="tooltip"
              role="tooltip"
              style={{
                top: coords.top,
                left: coords.left,
                transform: placement === 'bottom' ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)'
              }}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
