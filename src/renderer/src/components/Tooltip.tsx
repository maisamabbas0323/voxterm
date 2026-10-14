import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  label: string
  children: ReactNode
  /**
   * `right` parks the tooltip beside the trigger with an 8px gap (nav rail),
   * `top`/`bottom` centre above/below it. Near a window edge the tooltip is
   * shifted or flipped so it can never leave the viewport.
   */
  placement?: 'top' | 'bottom' | 'right'
  /** Hover delay before showing, so quick passes never flash a tooltip. */
  delayMs?: number
  /** Only show when the label adds information (defaults to true). */
  disabled?: boolean
}

const GAP = 8
const SHOW_DELAY = 150

/**
 * One shared tooltip for the whole app. Rendered through a portal at
 * document.body with fixed positioning, so no `overflow: hidden` ancestor can
 * ever clip it. Shows after a 150ms delay (and instantly on keyboard focus),
 * hides instantly on leave, blur, click or Escape, and never wraps.
 */
export function Tooltip({
  label,
  children,
  placement = 'right',
  delayMs = SHOW_DELAY,
  disabled
}: TooltipProps): ReactNode {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback((): { top: number; left: number } => {
    const node = anchorRef.current
    const rect = node?.getBoundingClientRect() ?? {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Tooltip is single-line; assume a generous width for edge clamping.
    const APPROX_WIDTH = 180
    if (placement === 'right') {
      let left = rect.right + GAP
      // No room to the right? Park it to the left of the trigger instead.
      if (left + APPROX_WIDTH > vw - GAP) {
        left = Math.max(GAP, rect.left - GAP - APPROX_WIDTH)
      }
      const top = rect.top + rect.height / 2
      return { top: Math.min(Math.max(top, GAP), vh - GAP), left }
    }
    const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - GAP
    const centred = rect.left + rect.width / 2
    // Clamp so the centred box never leaves the window.
    const left = Math.min(Math.max(centred, APPROX_WIDTH / 2 + GAP), vw - APPROX_WIDTH / 2 - GAP)
    return { top, left }
  }, [placement])

  const show = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      setCoords(measure())
    }, delayMs)
  }, [delayMs, measure])

  const hide = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    setCoords(null)
  }, [])

  useEffect(() => {
    if (!coords) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    const onReflow = (): void => hide()
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [coords, hide])

  useEffect(() => hide, [hide])

  return (
    <span
      className="tooltip-anchor"
      ref={anchorRef}
      onMouseEnter={disabled ? undefined : show}
      onMouseLeave={hide}
      onMouseDown={hide}
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
                transform:
                  placement === 'bottom'
                    ? 'translateX(-50%)'
                    : placement === 'top'
                      ? 'translateX(-50%) translateY(-100%)'
                      : 'translateY(-50%)'
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
