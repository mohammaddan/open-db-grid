// Keyboard shortcut registry. Declarative + rebindable map; every action
// dispatches through the same callbacks as the command palette.

import { useEditorStore, editorHandles } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { useExplorerStore } from '@renderer/state/explorer'
import { useSettingsStore } from '@renderer/state/settings'
import { formatSql } from '@shared/sql/formatter'

export type ActionId =
  | 'execute'
  | 'executeAll'
  | 'executeSelection'
  | 'format'
  | 'newQuery'
  | 'closeTab'
  | 'palette'
  | 'searchConnections'
  | 'newConnection'
  | 'refreshExplorer'
  | 'history'
  | 'begin'
  | 'commit'
  | 'rollback'
  | 'explain'
  | 'explainAnalyze'

export interface ShortcutKey {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export type ShortcutMap = Partial<Record<ActionId, ShortcutKey[]>>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  execute: [{ key: 'Enter', ctrl: true }],
  executeAll: [{ key: 'Enter', ctrl: true, shift: true }],
  executeSelection: [{ key: 'Enter', ctrl: true, alt: true }],
  format: [{ key: 'f', ctrl: true, shift: true }],
  newQuery: [{ key: 't', ctrl: true }],
  closeTab: [{ key: 'w', ctrl: true }],
  palette: [{ key: 'p', ctrl: true, shift: true }],
  searchConnections: [{ key: 'f', ctrl: true }],
  newConnection: [{ key: 'n', ctrl: true, shift: true }],
  refreshExplorer: [{ key: 'r', ctrl: true, shift: true }],
  history: [{ key: 'h', ctrl: true, shift: true }],
  explain: [{ key: 'e', ctrl: true, shift: true }]
}

// -- helpers ---------------------------------------------------------------

function activeTabId(): string | null {
  return useEditorStore.getState().activeId
}

function requireConnection(): boolean {
  const id = activeTabId()
  const tab = useEditorStore.getState().tabs.find((t) => t.id === id)
  if (!tab?.connectionId) {
    useUiStore.getState().pushToast('error', 'Select a connection for the current tab first.')
    return false
  }
  return true
}
import { useConnectionsStore } from '@renderer/state/connections'

function useConnectionsSelection(): string | null {
  return useConnectionsStore.getState().selectedId
}

export const actions: Record<ActionId, { title: string; hint?: string; run: () => void }> = {
  execute: {
    title: 'Execute Query',
    hint: 'Ctrl+Enter',
    run: () => {
      if (!requireConnection()) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())
      if (tab) void useEditorStore.getState().run(tab.id, 'current')
    }
  },
  executeAll: {
    title: 'Execute Entire Script',
    hint: 'Ctrl+Shift+Enter',
    run: () => {
      if (!requireConnection()) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())
      if (tab) void useEditorStore.getState().run(tab.id, 'all')
    }
  },
  executeSelection: {
    title: 'Execute Selected SQL',
    hint: 'Ctrl+Alt+Enter',
    run: () => {
      if (!requireConnection()) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())
      if (tab) void useEditorStore.getState().run(tab.id, 'selection')
    }
  },
  format: {
    title: 'Format SQL',
    hint: 'Shift+Alt+F',
    run: () => formatActiveEditor()
  },
  newQuery: {
    title: 'New Query',
    hint: 'Ctrl+T',
    run: () => {
      const sel = useConnectionsSelection()
      useEditorStore.getState().newQueryTab(sel, '')
    }
  },
  closeTab: {
    title: 'Close Tab',
    hint: 'Ctrl+W',
    run: () => {
      const id = activeTabId()
      if (id) closeTabSafe(id)
    }
  },
  palette: {
    title: 'Command Palette',
    hint: 'Ctrl+Shift+P',
    run: () => useUiStore.getState().togglePalette()
  },
  searchConnections: {
    title: 'Search Connections',
    hint: 'Ctrl+F',
    run: () => document.getElementById('conn-search')?.focus()
  },
  newConnection: {
    title: 'New Connection',
    hint: 'Ctrl+Shift+N',
    run: () => useUiStore.getState().openConnectionDialog(null)
  },
  refreshExplorer: {
    title: 'Refresh Database',
    hint: 'Ctrl+Shift+R',
    run: () => {
      const connId = useExplorerStore.getState().activeConnectionId
      if (connId) void useExplorerStore.getState().refresh(connId, '')
    }
  },
  history: {
    title: 'Open Query History',
    hint: 'Ctrl+Shift+H',
    run: () => useUiStore.getState().toggleHistory()
  },
  begin: {
    title: 'Begin Transaction',
    run: () => {
      const connId = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())?.connectionId
      if (connId) void useEditorStore.getState().beginTxn(connId)
    }
  },
  commit: {
    title: 'Commit Transaction',
    run: () => {
      const connId = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())?.connectionId
      if (connId) void useEditorStore.getState().commitTxn(connId)
    }
  },
  rollback: {
    title: 'Rollback Transaction',
    run: () => {
      const connId = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())?.connectionId
      if (connId) void useEditorStore.getState().rollbackTxn(connId)
    }
  },
  explain: {
    title: 'EXPLAIN Selected Statement',
    hint: 'Ctrl+Shift+E',
    run: () => {
      if (!requireConnection()) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())
      if (tab) void useEditorStore.getState().explain(tab.id, false)
    }
  },
  explainAnalyze: {
    title: 'EXPLAIN ANALYZE Selected Statement',
    hint: 'Ctrl+Shift+A',
    run: () => {
      if (!requireConnection()) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId())
      if (tab) void useEditorStore.getState().explain(tab.id, true)
    }
  }
}

function formatActiveEditor(): void {
  const id = activeTabId()
  const handle = id ? editorHandles.get(id) : undefined
  if (!handle) return
  const settings = useSettingsStore.getState().settings
  handle.replaceAll((sql) => formatSql({ sql, dialect: 'postgresql', settings: settings.formatting }))
}
export { formatActiveEditor }

export function closeTabSafe(id: string): void {
  const tab = useEditorStore.getState().tabs.find((t) => t.id === id)
  if (!tab) return
  const dirty = tab.dirty || tab.pending.length > 0 || tab.running
  if (dirty) {
    useUiStore.getState().requestConfirm({
      title: 'Close tab?',
      message: '"' + tab.title + '" has unsaved SQL or pending changes.',
      confirmLabel: 'Close anyway',
      danger: true,
      onConfirm: () => useEditorStore.getState().closeTab(id)
    })
    return
  }
  useEditorStore.getState().closeTab(id)
}

// -- shortcut matching + wiring -------------------------------------------------

function matches(e: KeyboardEvent, s: ShortcutKey): boolean {
  const mac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlOrMeta = mac ? e.metaKey : e.ctrlKey
  if (ctrlOrMeta !== Boolean(s.ctrl)) return false
  if (e.altKey !== Boolean(s.alt)) return false
  if (e.shiftKey !== Boolean(s.shift)) return false
  return e.key.toLowerCase() === s.key.toLowerCase()
}

export function setupShortcuts(): Array<() => void> {
  const onKeyDown = (e: KeyboardEvent): void => {
    for (const [action, keys] of Object.entries(DEFAULT_SHORTCUTS)) {
      if (!keys) continue
      for (const s of keys) {
        if (matches(e, s)) {
          e.preventDefault()
          actions[action as ActionId].run()
          return
        }
      }
    }
    if (e.key === 'Escape') {
      const ui = useUiStore.getState()
      if (ui.paletteOpen) ui.closePalette()
      else if (ui.historyOpen) ui.closeHistory()
      else if (ui.savedOpen) ui.closeSaved()
      else if (ui.confirm) ui.dismissConfirm()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return [() => window.removeEventListener('keydown', onKeyDown)]
}