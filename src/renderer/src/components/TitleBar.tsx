import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** Custom window chrome with working minimise / maximise / close controls. */
export function TitleBar({ contextLabel }: { contextLabel?: string }): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    void window.voxterm.window.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    const unsubscribe = window.voxterm.window.onMaximizedChanged(setMaximized)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__mark" aria-hidden="true" />
        <span className="titlebar__name">VoxTerm</span>
        {contextLabel ? <span className="titlebar__context">{contextLabel}</span> : null}
      </div>
      <div className="titlebar__drag" />
      <div className="titlebar__controls">
        <Tooltip label="Minimize">
          <button
            className="titlebar__button"
            onClick={() => void window.voxterm.window.minimize()}
            aria-label="Minimize window"
          >
            <Minus size={15} />
          </button>
        </Tooltip>
        <Tooltip label={maximized ? 'Restore' : 'Maximize'}>
          <button
            className="titlebar__button"
            onClick={() => void window.voxterm.window.maximizeToggle()}
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
        </Tooltip>
        <Tooltip label="Close">
          <button
            className="titlebar__button titlebar__button--close"
            onClick={() => void window.voxterm.window.close()}
            aria-label="Close window"
          >
            <X size={15} />
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
