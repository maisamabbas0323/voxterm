import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface MenuSeparator {
  id: string
  type: 'separator'
}

export interface MenuLabel {
  id: string
  type: 'label'
  label: string
}

export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

interface ContextMenuProps {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return !('type' in entry)
}

/** Keyboard-navigable context menu rendered in a portal at the cursor. */
export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: y, left: x })

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - rect.height - margin)
    setPosition({ top, left })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [])

  return createPortal(
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {entries.map((entry) => {
        if ('type' in entry && entry.type === 'separator') {
          return <div className="menu__divider" key={entry.id} />
        }
        if ('type' in entry && entry.type === 'label') {
          return (
            <div className="menu__label" key={entry.id}>
              {entry.label}
            </div>
          )
        }
        if (!isItem(entry)) return null
        return (
          <button
            key={entry.id}
            role="menuitem"
            className={entry.danger ? 'menu__item menu__item--danger' : 'menu__item'}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect()
              onClose()
            }}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.shortcut ? <span className="menu__shortcut">{entry.shortcut}</span> : null}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

/** Hook that manages context-menu open state and cursor position. */
export function useContextMenu<T>(): {
  menu: { x: number; y: number; context: T } | null
  open: (event: { clientX: number; clientY: number; preventDefault: () => void }, context: T) => void
  close: () => void
} {
  const [menu, setMenu] = useState<{ x: number; y: number; context: T } | null>(null)
  return {
    menu,
    open: (event, context) => {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, context })
    },
    close: () => setMenu(null)
  }
}
