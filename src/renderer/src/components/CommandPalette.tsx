import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { actions, type ActionId } from '@renderer/lib/shortcuts'
import { useUiStore } from '@renderer/state/ui'
import {
  Search,
  Terminal,
  Play,
  FileCode,
  Plus,
  RefreshCw,
  History,
  Lock,
  CheckCircle2,
  RotateCcw,
  HelpCircle,
  X,
  Database,
  Eye,
  Bookmark,
  ShieldCheck
} from 'lucide-react'
import { useSettingsStore } from '@renderer/state/settings'
import { AVAILABLE_THEMES } from '@shared/models/settings'

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

const ACTION_ICONS: Record<string, ReactNode> = {
  newQuery: <Plus size={14} />,
  newConnection: <Database size={14} />,
  execute: <Play size={14} />,
  executeSelection: <Play size={14} />,
  executeAll: <Play size={14} />,
  format: <FileCode size={14} />,
  refreshExplorer: <RefreshCw size={14} />,
  history: <History size={14} />,
  begin: <Lock size={14} />,
  commit: <CheckCircle2 size={14} />,
  rollback: <RotateCcw size={14} />,
  explain: <HelpCircle size={14} />,
  explainAnalyze: <Eye size={14} />,
  closeTab: <X size={14} />,
  palette: <Terminal size={14} />,
  searchConnections: <Search size={14} />
}



const EXTRA_COMMANDS: Array<{ title: string; hint?: string; icon?: ReactNode; run: () => void }> = [
  { title: 'Toggle Read Only Hint', icon: <ShieldCheck size={14} />, run: () => undefined },
  { title: 'Open Saved Queries', icon: <Bookmark size={14} />, run: () => useUiStore.getState().openSaved() },
  ...AVAILABLE_THEMES.map((th) => ({
    title: `Theme: ${th.name}`,
    hint: th.category,
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: th.accentColor,
          boxShadow: `0 0 6px ${th.accentColor}`
        }}
      />
    ),
    run: () => void useSettingsStore.getState().setTheme(th.id)
  }))
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
        icon: ACTION_ICONS[id] ?? <Terminal size={14} />,
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
    <div className="palette-overlay" onMouseDown={close}>
      <div className="palette-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-header">
          <Search size={15} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Type a command or action…"
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
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <kbd className="palette-esc-badge" onClick={close}>ESC</kbd>
        </div>
        <div className="palette-list">
          {commands.map((cmd, i) => (
            <button
              key={cmd.title}
              type="button"
              className={'palette-item' + (i === index ? ' active' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
            >
              <div className="palette-item-left">
                <span className="palette-item-icon">{cmd.icon}</span>
                <span className="palette-item-title">{cmd.title}</span>
              </div>
              {cmd.hint && <kbd className="palette-item-hint">{cmd.hint}</kbd>}
            </button>
          ))}
          {commands.length === 0 && (
            <div className="palette-empty">
              <Terminal size={22} className="palette-empty-icon" />
              <span>No matching commands</span>
            </div>
          )}
        </div>
        <div className="palette-footer">
          <span className="palette-footer-hint"><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span>
          <span className="palette-footer-hint"><kbd>↵</kbd> Select</span>
          <span className="palette-footer-hint"><kbd>esc</kbd> Dismiss</span>
        </div>
      </div>
    </div>
  )
}

