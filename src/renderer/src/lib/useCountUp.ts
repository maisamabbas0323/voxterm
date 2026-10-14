import { useEffect, useRef, useState } from 'react'

/**
 * Animate a number from 0 to its target over 400ms, once per target change.
 * Whole numbers only. Honours prefers-reduced-motion by jumping straight to
 * the target; the app-wide tokens already collapse durations when the user
 * sets Reduce motion.
 */
export function useCountUp(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target)
  const frame = useRef(0)

  useEffect(() => {
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || durationMs <= 0) {
      setValue(target)
      return
    }
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic keeps the settle short so counts feel snappy, not showy.
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [target, durationMs])

  return value
}
