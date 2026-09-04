import { Database, Play, Square, Wand2, ListPlus, Save as SaveIcon, GitBranch } from 'lucide-react'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { useConnectionsStore } from '@renderer/state/connections'
import { formatActiveEditor, actions } from '@renderer/lib/shortcuts'

export function TopToolbar(): JSX.Element {
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const openPalette = useUiStore((s) => s.openPalette)
  const openConnectionDialog = useUiStore((s) => s.openConnectionDialog)
  const connections = useConnectionsStore((s) => s.connections)

  const selectedConnId = useConnectionsStore((s) => s.selectedId)
  const tabConnId = activeTab?.connectionId ?? selectedConnId

  const runExecute = () => void actions.execute.run()
  const runAll = () => void actions.executeAll.run()
  const runFormat = () => formatActiveEditor()

  const saveQuery = async (): Promise<void> => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === useEditorStore.getState().activeId)
    if (!tab || !tab.sql.trim()) return
    const name = window.prompt('Name for this saved query', '')
    if (!name) return
    await window.api.saved.save({ name, sql: tab.sql, connectionId: tab.connectionId ?? undefined })
    useUiStore.getState().pushToast('success', 'Query saved.')
  }

  return (
    <div className="toolbar">
      <div className="brand">
        <Database size={15} />
        DBForge
      </div>

      <button className="btn" title="New Query (Ctrl+T)" onClick={() => useEditorStore.getState().newQueryTab(tabConnId, '')}>
        <ListPlus size={14} /> New Query
      </button>
      <button className="btn" title="New Connection (Ctrl+Shift+N)" onClick={() => openConnectionDialog(null)}>
        <Database size={14} /> New Connection
      </button>

      <div className="sep" />

      <button className="btn primary" title="Execute current statement (Ctrl+Enter)" onClick={runExecute} disabled={!tabConnId}>
        <Play size={14} /> Execute
      </button>
      <button className="btn" title="Execute entire script (Ctrl+Shift+Enter)" onClick={runAll} disabled={!tabConnId}>
        <Play size={14} /> Run All
      </button>
      <button className="btn" title="EXPLAIN selected statement" onClick={() => void actions.explain.run()} disabled={!tabConnId}>
        <Wand2 size={14} /> Explain
      </button>
      <button className="btn" title="Format SQL (Shift+Alt+F)" onClick={runFormat}>
        <Wand2 size={14} /> Format
      </button>

      <div className="sep" />

      <select
        style={{ width: 220, background: 'var(--input-bg)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 4, height: 26 }}
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

      <button className="btn" title="Save query" onClick={() => void saveQuery()}>
        <SaveIcon size={14} /> Save
      </button>
      <button className="btn" title="Begin transaction" onClick={() => { if (tabConnId) void useEditorStore.getState().beginTxn(tabConnId) }}>
        <GitBranch size={14} />
      </button>

      <div className="spacer" />

      {connections.length > 0 && (
        <button className="btn" title="Command palette (Ctrl+Shift+P)" onClick={openPalette}>
          Palette
        </button>
      )}
    </div>
  )
}