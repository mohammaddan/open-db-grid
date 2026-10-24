import { Database, Play, Square, Wand2, ListPlus, Save as SaveIcon, GitBranch, Check, X } from 'lucide-react'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { useConnectionsStore } from '@renderer/state/connections'
import { formatActiveEditor, actions } from '@renderer/lib/shortcuts'

export function TopToolbar(): JSX.Element {
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const txnState = useEditorStore((s) => s.txnState)
  const openPalette = useUiStore((s) => s.openPalette)
  const openConnectionDialog = useUiStore((s) => s.openConnectionDialog)
  const requestPrompt = useUiStore((s) => s.requestPrompt)
  const pushToast = useUiStore((s) => s.pushToast)
  const connections = useConnectionsStore((s) => s.connections)

  const selectedConnId = useConnectionsStore((s) => s.selectedId)
  const tabConnId = activeTab?.connectionId ?? selectedConnId
  const isRunning = Boolean(activeTab?.running)
  const isTxnOpen = tabConnId ? txnState[tabConnId] === 'open' : false

  const runExecute = () => void actions.execute.run()
  const runAll = () => void actions.executeAll.run()
  const runFormat = () => formatActiveEditor()
  const runCancel = () => {
    if (activeTab?.id) {
      void useEditorStore.getState().cancelRun(activeTab.id)
    }
  }

  const saveQuery = (): void => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === useEditorStore.getState().activeId)
    if (!tab || !tab.sql.trim()) {
      pushToast('info', 'Query tab is empty.')
      return
    }
    requestPrompt({
      title: 'Save Query',
      message: 'Enter a descriptive name for this query:',
      placeholder: 'e.g. Active Users by Region',
      confirmLabel: 'Save Query',
      onConfirm: async (name) => {
        await window.api.saved.save({ name, sql: tab.sql, connectionId: tab.connectionId ?? undefined })
        pushToast('success', `Saved query "${name}".`)
      }
    })
  }

  return (
    <div className="toolbar">
      <button
        className="btn"
        title="New Query (Ctrl+T)"
        onClick={() => useEditorStore.getState().newQueryTab(tabConnId, '')}
      >
        <ListPlus size={14} /> New Query
      </button>
      <button
        className="btn"
        title="New Connection (Ctrl+Shift+N)"
        onClick={() => openConnectionDialog(null)}
      >
        <Database size={14} /> New Connection
      </button>

      <div className="sep" />

      <button
        className="btn primary cyber-btn"
        title="Execute current statement (Ctrl+Enter)"
        onClick={runExecute}
        disabled={!tabConnId || isRunning}
      >
        <Play size={13} fill="currentColor" /> Execute <span className="kbd-badge">Ctrl+↵</span>
      </button>

      <button
        className={'btn ' + (isRunning ? 'danger' : '')}
        title="Stop running query"
        onClick={runCancel}
        disabled={!isRunning}
      >
        <Square size={13} fill="currentColor" /> Stop
      </button>

      <button
        className="btn"
        title="Execute entire script (Ctrl+Shift+Enter)"
        onClick={runAll}
        disabled={!tabConnId || isRunning}
      >
        <Play size={13} /> Run All
      </button>

      <button
        className="btn"
        title="EXPLAIN selected statement (Ctrl+Shift+E)"
        onClick={() => void actions.explain.run()}
        disabled={!tabConnId || isRunning}
      >
        <Wand2 size={13} /> Explain
      </button>

      <button className="btn" title="Format SQL (Ctrl+Shift+F)" onClick={runFormat}>
        <Wand2 size={13} /> Format
      </button>

      <div className="sep" />

      {/* Connection Selector */}
      <select
        className="toolbar-select"
        style={{ width: 200 }}
        value={tabConnId ?? ''}
        onChange={(e) => {
          const id = e.target.value || null
          const active = useEditorStore.getState().activeId
          if (active) {
            useEditorStore.setState((s) => ({
              tabs: s.tabs.map((t) => (t.id === active ? { ...t, connectionId: id } : t))
            }))
          }
        }}
      >
        <option value="">No connection</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.accessMode === 'read-only' ? ' (read-only)' : ''}
          </option>
        ))}
      </select>

      {/* Transaction Controls */}
      {isTxnOpen ? (
        <div className="txn-chip active" title="Active open transaction">
          <span className="dot" />
          <span>In Txn</span>
          <button
            className="btn icon-only"
            style={{ width: 22, height: 20, color: 'var(--success)' }}
            title="Commit Transaction"
            onClick={() => { if (tabConnId) void useEditorStore.getState().commitTxn(tabConnId) }}
          >
            <Check size={13} />
          </button>
          <button
            className="btn icon-only"
            style={{ width: 22, height: 20, color: 'var(--danger)' }}
            title="Rollback Transaction"
            onClick={() => { if (tabConnId) void useEditorStore.getState().rollbackTxn(tabConnId) }}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          className="btn"
          title="Begin Transaction"
          disabled={!tabConnId}
          onClick={() => { if (tabConnId) void useEditorStore.getState().beginTxn(tabConnId) }}
        >
          <GitBranch size={13} /> Begin Txn
        </button>
      )}

      <button className="btn" title="Save query" onClick={saveQuery}>
        <SaveIcon size={13} /> Save
      </button>

      <div className="spacer" />

      {connections.length > 0 && (
        <button className="btn" title="Command palette (Ctrl+Shift+P)" onClick={openPalette}>
          Palette <span className="kbd-badge">Ctrl+Shift+P</span>
        </button>
      )}
    </div>
  )
}