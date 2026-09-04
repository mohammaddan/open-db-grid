import { useEffect, useState, useCallback } from 'react'

export interface ContextMenuItem {
  label: string
  action?: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export function useContextMenu(): {
  menu: ContextMenuState | null
  open: (e: React.MouseEvent, items: ContextMenuItem[]) => void
  close: () => void
} {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  useEffect(() => {
    const onMouseDown = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return { menu, open, close }
}

export function ContextMenuView({
  menu,
  onClose
}: {
  menu: ContextMenuState
  onClose: () => void
}): JSX.Element {
  if (!menu) return <></>
  return (
    <div
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) =>
        item.separatorBefore ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={['ctx-item', item.danger ? 'danger' : '', item.disabled ? 'disabled' : ''].join(' ')}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.action?.()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}