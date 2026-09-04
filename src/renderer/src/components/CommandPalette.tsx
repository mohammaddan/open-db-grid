import { useEffect, useMemo, useRef, useState } from 'react'
import { actions, type ActionId } from '@renderer/lib/shortcuts'
import { useUiStore } from '@renderer/state/ui'

const PALETTE_ACTIONS: ActionId[] = [
  'newQuery',
  'newConnection',
  'execute',
  'executeSelection',
  'executeAll',
  'format',
  'refreshExplorer',
  'history',
  'begin',
  'commit',
  'rollback',
  'explain',
  'explainAnalyze',
  'closeTab',
  'palette',
  'searchConnections'
]

const EXTRA_COMMANDS: Array<{ title: string; hint?: string; run: () => void }> = [
  { title: 'Toggle Read Only Hint', run: () => undefined },
  { title: 'Open Saved Queries', run: () => useUiStore.getState().openSaved() },
  { title: 'Toggle Theme', run: () => undefined }
]

export function CommandPalette(): JSX.Element | null {
  const open = useUiStore((s) => s.paletteOpen)
  const close = useUiStore((s) => s.closePalette)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const commands = useMemo(() => {
    const all = [
      ...PALETTE_ACTIONS.map((id) => ({
        title: actions[id].title,
        hint: actions[id].hint,
        run: actions[id].run
      })),
      ...EXTRA_COMMANDS
    ]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((c) => c.title.toLowerCase().includes(q))
  }, [query])

  if (!open) return null

  const runAt = (i: number): void => {
    const cmd = commands[i]
    if (!cmd) return
    close()
    cmd.run()
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, commands.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runAt(index)
            }
          }}
        />
        <div className="palette-list">
          {commands.map((cmd, i) => (
            <button
              key={cmd.title}
              className={'palette-item' + (i === index ? ' active' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
            >
              <span>{cmd.title}</span>
              {cmd.hint && <span className="hint">{cmd.hint}</span>}
            </button>
          ))}
          {commands.length === 0 && <div className="palette-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  )
}
