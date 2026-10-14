import { useId, type ReactNode } from 'react'

interface LogoProps {
  /** Rendered size in pixels (square). */
  size?: number
  /** Draw the rounded dark plate behind the monogram. */
  plate?: boolean
  className?: string
  /** Accessible label; defaults to the product name. */
  title?: string
}

/**
 * The VoxTerm monogram: a bold gradient "V" whose vertex doubles as the
 * endpoint of a small audio waveform — a quiet nod to the "Vox" half of the
 * name. Drawn entirely in SVG so it stays crisp at any size.
 */
export function Logo({ size = 28, plate = true, className, title }: LogoProps): ReactNode {
  const raw = useId()
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title ?? 'VoxTerm'}
      focusable="false"
    >
      <defs>
        <linearGradient id={`plate-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#181824" />
          <stop offset="52%" stopColor="#0c0c12" />
          <stop offset="100%" stopColor="#050506" />
        </linearGradient>
        <linearGradient id={`vleft-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a9c1ff" />
          <stop offset="50%" stopColor="#7aa2f7" />
          <stop offset="100%" stopColor="#5f86e6" />
        </linearGradient>
        <linearGradient id={`vright-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7dcfff" />
          <stop offset="55%" stopColor="#7aa2f7" />
          <stop offset="100%" stopColor="#bb9af7" />
        </linearGradient>
        <linearGradient id={`wave-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a4e1ff" />
          <stop offset="100%" stopColor="#7aa2f7" />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="40%" r="62%">
          <stop offset="0%" stopColor="#7aa2f7" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#7aa2f7" stopOpacity="0" />
        </radialGradient>
        <filter id={`soft-${uid}`} x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>

      {plate ? (
        <g>
          <rect x="0" y="0" width="64" height="64" rx="16" fill={`url(#plate-${uid})`} />
          <rect
            x="0.5"
            y="0.5"
            width="63"
            height="63"
            rx="15.5"
            fill="none"
            stroke="#7aa2f7"
            strokeOpacity="0.22"
          />
          <rect x="0" y="0" width="64" height="64" rx="16" fill={`url(#glow-${uid})`} opacity="0.55" />
        </g>
      ) : null}

      {/* Soft under-glow traces the whole V. */}
      <path
        d="M15 14.5 L32 45.5 L49 14.5"
        fill="none"
        stroke={`url(#vright-${uid})`}
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
        filter={`url(#soft-${uid})`}
      />

      {/* Audio waveform resting inside the mouth of the V. */}
      <g stroke={`url(#wave-${uid})`} strokeWidth="2.4" strokeLinecap="round" opacity="0.92">
        <line x1="26.2" y1="28.6" x2="26.2" y2="33.4" />
        <line x1="32" y1="25.6" x2="32" y2="36.4" />
        <line x1="37.8" y1="27.4" x2="37.8" y2="34.6" />
      </g>

      {/* The V itself, drawn as two beveled arms. */}
      <path
        d="M15 14.5 L32 45.5"
        fill="none"
        stroke={`url(#vleft-${uid})`}
        strokeWidth="8.4"
        strokeLinecap="round"
      />
      <path
        d="M32 45.5 L49 14.5"
        fill="none"
        stroke={`url(#vright-${uid})`}
        strokeWidth="8.4"
        strokeLinecap="round"
      />

      {/* Top-edge highlight for a machined, dimensional finish. */}
      <path
        d="M14.1 13.6 L31.1 44.6"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M31.1 44.6 L48.1 13.6"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.3"
        strokeWidth="2.4"
        strokeLinecap="round"
      />

      {/* Bright node at the vertex. */}
      <circle cx="32" cy="45.5" r="3" fill="#eaf2ff" />
      <circle cx="32" cy="45.5" r="5.4" fill="none" stroke="#7dcfff" strokeOpacity="0.55" strokeWidth="1.1" />
    </svg>
  )
}
