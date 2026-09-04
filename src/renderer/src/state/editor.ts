import { create } from 'zustand'
import type {
  ExecuteResult,
  QueryErrorInfo,
  QueryPage,
  ExportFormat
} from '@shared/models/result'
import type { SafeEditPlan, PendingEdit, BrowseTarget } from '@shared/models/explorer'
import { splitSqlStatements, statementsForSelection } from '@shared/sql/splitter'
import { classifyStatement } from '@shared/sql/classifier'
import { useUiStore } from './ui'
import { useSettingsStore } from './settings'
import { useConnectionsStore } from './connections'
import { extractApiError } from '@renderer/lib/api'

export type EditorTabKind = 'query' | 'browse'

export interface EditorTab {
  id: string
  kind: EditorTabKind
  title: string
  connectionId: string | null
  sql: string
  dirty: boolean
  running: boolean
  /** session key for the in-flight execution attempt (used by cancelRun) */
  runningKey?: string
  result: ExecuteResult | null
  error: QueryErrorInfo | null
  plan: SafeEditPlan | null
  hasMore: boolean
  pending: PendingEdit[]
  browseTarget: BrowseTarget | null
}

export type RunMode = 'current' | 'selection' | 'all'

export interface EditorSelectionHandle {
  getSelection: () => { from: number; to: number; selected: string }
  /** replace the whole document through the formatter */
  replaceAll: (transform: (sql: string) => string) => void
  /** format the current selection (falls back to whole doc) */
  formatSelection: () => void
}

export const editorHandles = new Map<string, EditorSelectionHandle>()

let tabCounter = 0

interface EditorState {
  tabs: EditorTab[]
  activeId: string | null
  txnState: Record<string, 'none' | 'open'>

  newQueryTab: (connectionId?: string | null, sql?: string) => string
  openBrowse: (connectionId: string, target: BrowseTarget) => Promise<void>
  closeTab: (id: string) => void
  activate: (id: string) => void
  setSql: (id: string, sql: string, dirty?: boolean) => void
  run: (tabId: string, mode: RunMode) => Promise<void>
  cancelRun: (tabId: string) => Promise<void>
  loadMore: (tabId: string) => Promise<void>
  explain: (tabId: string, analyze: boolean) => Promise<void>
  exportResult: (tabId: string, format: ExportFormat) => Promise<void>
  applyEdit: (
    tabId: string,
    rowKey: number,
    column: string,
    oldValue: unknown,
    newValue: unknown,
    pkValues: Array<{ column: string; value: unknown }>
  ) => void
  discardEdits: (tabId: string) => void
  saveEdits: (tabId: string) => Promise<void>
  refreshTxnState: (connectionId: string) => Promise<void>
  beginTxn: (connectionId: string) => Promise<void>
  commitTxn: (connectionId: string) => Promise<void>
  rollbackTxn: (connectionId: string) => Promise<void>
  setTxnState: (connectionId: string, state: 'none' | 'open') => void
}

function newId(): string {
  return `${Date.now().toString(36)}-${(tabCounter++).toString(36)}`
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeId: null,
  txnState: {},

  newQueryTab(connectionId = null, sql = '') {
    const id = newId()
    const conn = connectionId
      ? useConnectionsStore.getState().connections.find((c) => c.id === connectionId)
      : undefined
    const tab: EditorTab = {
      id,
      kind: 'query',
      title: conn ? 'Query' : 'Query',
      connectionId,
      sql,
      dirty: false,
      running: false,
      result: null,
      error: null,
      plan: null,
      hasMore: false,
      pending: [],
      browseTarget: null
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
    return id
  },

  async openBrowse(connectionId, target) {
    const id = newId()
    const tab: EditorTab = {
      id,
      kind: 'browse',
      title: target.table,
      connectionId,
      sql: `SELECT * FROM "${target.schema.replace(/"/g, '""')}"."${target.table.replace(/"/g, '""')}"`,
      dirty: false,
      running: true,
      result: null,
      error: null,
      plan: null,
      hasMore: false,
      pending: [],
      browseTarget: target
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
    try {
      const result = await window.api.explorer.browse(connectionId, target, 500)
      const plan = await fetchPlan(connectionId, tab.sql, result)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? { ...t, running: false, result, plan, hasMore: result.page?.hasMore ?? false }
            : t
        )
      }))
    } catch (err) {
      const info = extractApiError(err)
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: false, error: info } : t))
      }))
    }
  },

  closeTab(id) {
    const tabs = get().tabs
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = tabs[idx]
    if (tab.result?.sessionId && tab.connectionId) {
      void window.api.query.close(tab.connectionId, tab.result.sessionId)
    }
    const next = tabs.filter((t) => t.id !== id)
    let activeId = get().activeId
    if (activeId === id) {
      activeId = next[Math.min(idx, next.length - 1)]?.id ?? null
    }
    set({ tabs: next, activeId })
  },

  activate(id) {
    set({ activeId: id })
  },

  setSql(id, sql, dirty = true) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql, dirty } : t))
    }))
  },
async cancelRun(tabId) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.connectionId || !tab.running) return
    const sessionId = tab.runningKey ?? tab.result?.sessionId
    if (!sessionId) return
    const res = await window.api.query.cancel(tab.connectionId, sessionId)
    useUiStore.getState().pushToast('info', res.message ?? 'Cancellation requested.')
  },

  async loadMore(tabId) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.connectionId || !tab.result?.sessionId || !tab.hasMore) return
    try {
      const page = await window.api.query.page(tab.connectionId, tab.result.sessionId, 500)
      appendPage(get, tabId, page)
    } catch (err) {
      const info = extractApiError(err)
      useUiStore.getState().pushToast('error', info.message)
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, error: info } : t))
      }))
    }
  },

  async explain(tabId, analyze) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.connectionId) return
    const handle = editorHandles.get(tabId)
    const sel = handle ? handle.getSelection() : { from: 0, to: 0, selected: '' }
    const stmts = statementsForSelection(tab.sql, sel.from, sel.to)
    if (stmts.length === 0) return
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t))
    }))
    try {
      const plan = await window.api.query.explain({
        connectionId: tab.connectionId,
        sql: stmts[0].text,
        analyze
      })
      const cols = [{ name: 'QUERY PLAN', dataType: 'text', nullable: true }]
      const result: ExecuteResult = {
        kind: 'EXPLAIN',
        sql: stmts[0].text,
        durationMs: plan.durationMs,
        columns: cols,
        page: {
          columns: cols,
          rows: plan.rows.map((line, i) => ({ __rowId: i + 1, 'QUERY PLAN': line })),
          hasMore: false,
          fetched: plan.rows.length
        },
        rowsAffected: 0
      }
      const p = await fetchPlan(tab.connectionId, stmts[0].text, result).catch(() => null)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, running: false, result, plan: p, hasMore: false, error: null, pending: [] }
            : t
        )
      }))
    } catch (err) {
      const info = extractApiError(err)
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, running: false, error: info } : t))
      }))
    }
  },

  async exportResult(tabId, format) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.connectionId || !tab.result?.sessionId) return
    const conn = useConnectionsStore.getState().connections.find((c) => c.id === tab.connectionId)
    const name = (conn?.name ?? 'export').replace(/\s+/g, '_') + '-' + Date.now() + '.' + format
    const filePath = await window.api.dialog.chooseExportFile(name)
    if (!filePath) return
    try {
      const res = await window.api.query.exportResult({
        connectionId: tab.connectionId,
        sessionId: tab.result.sessionId,
        format,
        filePath
      })
      useUiStore.getState().pushToast(
        'success',
        'Exported ' + res.rows.toLocaleString() + ' rows (' + format.toUpperCase() + ').'
      )
    } catch (err) {
      useUiStore.getState().pushToast('error', extractApiError(err).message)
    }
  },
async run(tabId, mode) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || !tab.connectionId) {
      useUiStore.getState().pushToast('error', 'Select a connection for this tab first.')
      return
    }
    const conn = useConnectionsStore.getState().connections.find((c) => c.id === tab.connectionId)
    if (!conn) return

    const sql = tab.sql
    const handle = editorHandles.get(tabId)
    const sel = handle ? handle.getSelection() : { from: 0, to: 0, selected: '' }

    let statements: ReturnType<typeof splitSqlStatements> = []
    if (mode === 'all') {
      statements = splitSqlStatements(sql)
    } else {
      statements = statementsForSelection(sql, sel.from, sel.to)
    }
    if (statements.length === 0) {
      useUiStore.getState().pushToast('info', 'Nothing to execute.')
      return
    }

    const readonly =
      useConnectionsStore.getState().openInfo[tab.connectionId]?.readOnly ?? false
    const first = classifyStatement(statements[0].text)
    if (readonly && first.isModifying) {
      useUiStore.getState().pushToast(
        'error',
        'Blocked: connection "' + conn.name + '" is read-only. "' + first.kind + '" is not allowed.'
      )
      return
    }
    const settings = useSettingsStore.getState().settings
    if (first.isDangerous && settings.protection.confirmDangerous) {
      const preview = statements[0].text.slice(0, 160)
      useUiStore.getState().requestConfirm({
        title: first.kind + ' — potentially destructive',
        message: (statements[0].text.length > 160 ? preview + '…' : preview) || first.kind,
        detail:
          first.kind === 'DELETE' || first.kind === 'TRUNCATE' || first.kind === 'DROP'
            ? 'This statement permanently removes data or schema objects. It cannot be undone.'
            : undefined,
        confirmLabel: 'Run ' + first.kind,
        danger: true,
        onConfirm: () => void get().run(tabId, mode)
      })
      return
    }

    // release any previous cursor session before re-running
    const prevTab = get().tabs.find((t) => t.id === tabId)
    if (prevTab?.result?.sessionId && prevTab.connectionId) {
      void window.api.query.close(prevTab.connectionId, prevTab.result.sessionId)
    }

    // caller-chosen session key so a hung FIRST page is cancellable
    const runningKey = crypto.randomUUID()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, running: true, runningKey, error: null, pending: [], plan: null }
          : t
      )
    }))

    try {
      const isMulti = mode === 'all' || statements.length > 1
      const req = {
        connectionId: tab.connectionId,
        sql: statements.map((x) => x.text).join(';\n'),
        pageSize: 500,
        sessionKey: runningKey
      }
      const result = isMulti
        ? await window.api.query.executeScript(req)
        : await window.api.query.execute({ ...req, sql: statements[0].text })

      let plan: SafeEditPlan | null = null
      if (result.page) {
        const stmtText = isMulti ? statements[0].text : statements[0].text
        plan = await fetchPlan(tab.connectionId, stmtText, result).catch(() => null)
      }

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                running: false,
                runningKey: undefined,
                result,
                plan,
                hasMore: result.page?.hasMore ?? false,
                error: null,
                pending: []
              }
            : t
        )
      }))
    } catch (err) {
      const info = extractApiError(err)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, running: false, runningKey: undefined, error: info } : t
        )
      }))
    }
  },
applyEdit(tabId, rowKey, column, oldValue, newValue, pkValues) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const pending = t.pending.filter((p) => !(p.rowKey === rowKey && p.column === column))
        pending.push({ rowKey, column, oldValue, newValue, pkValues })
        let result = t.result ? { ...t.result } : null
        if (result?.page) {
          result.page.rows = result.page.rows.map((r) =>
            r.__rowId === rowKey ? { ...r, [column]: newValue } : r
          )
        }
        return { ...t, pending, result }
      })
    }))
  },

  discardEdits(tabId) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const result = t.result ? { ...t.result } : null
        if (result?.page) {
          result.page.rows = result.page.rows.map((r) => {
            const edits = t.pending.filter((p) => p.rowKey === r.__rowId)
            let row = { ...r }
            for (const e of edits) row[e.column] = e.oldValue
            return row
          })
        }
        return { ...t, pending: [], result }
      })
    }))
  },

  async saveEdits(tabId) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.connectionId || tab.pending.length === 0) return
    if (!tab.plan?.editable) {
      useUiStore.getState().pushToast(
        'error',
        'Result is not editable: ' + (tab.plan?.reason ?? 'unknown reason.')
      )
      return
    }
    try {
      const res = await window.api.query.saveEdits(tab.connectionId, tab.plan, tab.pending)
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pending: [], dirty: false } : t))
      }))
      if (res.firstError) {
        useUiStore.getState().pushToast(
          'error',
          'Saved ' + res.updated + ' row(s); ' + res.skipped + ' skipped. Error: ' + res.firstError.message
        )
      } else {
        useUiStore.getState().pushToast('success', 'Saved ' + res.updated + ' change(s).')
      }
    } catch (err) {
      useUiStore.getState().pushToast('error', extractApiError(err).message)
    }
  },

  async refreshTxnState(connectionId) {
    try {
      const status = await window.api.txn.status(connectionId)
      set((s) => ({ txnState: { ...s.txnState, [connectionId]: status.state } }))
    } catch {
      set((s) => ({ txnState: { ...s.txnState, [connectionId]: 'none' } }))
    }
  },

  async beginTxn(connectionId) {
    const res = await window.api.txn.begin(connectionId)
    if (!res.ok) {
      useUiStore.getState().pushToast('error', res.error?.message ?? 'Could not begin transaction.')
      return
    }
    set((s) => ({ txnState: { ...s.txnState, [connectionId]: 'open' } }))
    useUiStore.getState().pushToast('success', 'Transaction started.')
  },

  async commitTxn(connectionId) {
    const res = await window.api.txn.commit(connectionId)
    set((s) => ({ txnState: { ...s.txnState, [connectionId]: 'none' } }))
    if (!res.ok) useUiStore.getState().pushToast('error', res.error?.message ?? 'Commit failed.')
    else useUiStore.getState().pushToast('success', 'Transaction committed.')
  },

  async rollbackTxn(connectionId) {
    const res = await window.api.txn.rollback(connectionId)
    set((s) => ({ txnState: { ...s.txnState, [connectionId]: 'none' } }))
    if (!res.ok) useUiStore.getState().pushToast('error', res.error?.message ?? 'Rollback failed.')
    else useUiStore.getState().pushToast('success', 'Transaction rolled back.')
  },

  setTxnState(connectionId, state) {
    set((s) => ({ txnState: { ...s.txnState, [connectionId]: state } }))
  }
}))

// -- helpers --------------------------------------------------------------

async function fetchPlan(
  connectionId: string,
  sql: string,
  result: ExecuteResult
): Promise<SafeEditPlan | null> {
  if (!result.page || connectionId === '' || connectionId === null) return null
  const columns = result.page.columns.map((c) => c.name)
  try {
    return await window.api.explorer.plan(connectionId, sql, columns)
  } catch {
    return null
  }
}

function appendPage(
  getState: () => EditorState,
  tabId: string,
  page: QueryPage
): void {
  const state = getState()
  const set = useEditorStore.setState
  const tabs = state.tabs.map((t) => {
    if (t.id !== tabId || !t.result) return t
    const result = { ...t.result }
    if (result.page) {
      const combined = [...result.page.rows, ...page.rows]
      result.page = {
        columns: page.columns,
        rows: combined,
        hasMore: page.hasMore,
        fetched: result.page.fetched + page.rows.length
      }
      result.durationMs = (result.durationMs ?? 0) + (page.fetched > 0 ? 0 : 0)
    }
    return { ...t, result, hasMore: page.hasMore }
  })
  set({ tabs })
}