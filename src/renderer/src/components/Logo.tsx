import type { CSSProperties, ReactNode } from 'react'

interface LogoProps {
  /** Rendered size in pixels (square, drawn on the 64-unit design grid). */
  size?: number
  /** Draw the flat dark rounded plate (used on boot splash contexts). */
  plate?: boolean
  className?: string
  /** Accessible label; defaults to the product name. */
  title?: string
}

/**
 * The VoxTerm mark: a terminal prompt chevron followed by three rounded
 * voice-level bars (short, tall, medium) — "Vox" and "Term" in one drawn
 * gesture. Stroke-built with round caps and a single accent bar; no gradients
 * or glows, so it stays crisp and honest at every size. In-app strokes follow
 * `currentColor`, with the tallest bar in the theme accent.
 */
export function Logo({ size = 28, plate = false, className, title }: LogoProps): ReactNode {
  const style: CSSProperties | undefined = plate
    ? { padding: size * 0.16, background: '#0b0b0f', borderRadius: size * 0.3, border: '1px solid #232330', display: 'block' }
    : undefined

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={style}
      role="img"
      aria-label={title ?? 'VoxTerm'}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M12.5 19.5 L25 32 L12.5 44.5" strokeWidth={6.5} />
      <line x1="35.5" y1="26.5" x2="35.5" y2="38.5" strokeWidth={6} />
      <line x1="45" y1="18" x2="45" y2="46.5" strokeWidth={6} className="logo-mark__accent" />
      <line x1="54.5" y1="23" x2="54.5" y2="42" strokeWidth={6} />
    </svg>
  )
}
