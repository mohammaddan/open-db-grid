// Central workspace: tab strip (multiple SQL tabs) + active tab pane with
// the CodeMirror editor and the result grid.

import { X, Circle } from 'lucide-react'
import { useEditorStore, type EditorTab } from '@renderer/state/editor'
import { useConnectionsStore } from '@renderer/state/connections'
import { closeTabSafe } from '@renderer/lib/shortcuts'
import { SqlEditor } from './SqlEditor'
import { ResultTable } from './ResultTable'
import { colorOf } from '@shared/models/connection'

export function EditorArea(): JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const activate = useEditorStore((s) => s.activate)
  const newQueryTab = useEditorStore((s) => s.newQueryTab)
  const selectedConnId = useConnectionsStore((s) => s.selectedId)

  if (tabs.length === 0) {
    return (
      <div className="editor-area">
        <div className="editor-empty">
          <p>No query tabs open.</p>
          <button className="btn primary" onClick={() => newQueryTab(selectedConnId, '')}>
            New Query (Ctrl+T)
          </button>
        </div>
      </div>
    )
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  return (
    <div className="editor-area">
      <div className="tab-strip">
        {tabs.map((t) => (
          <TabChip
            key={t.id}
            tab={t}
            active={t.id === active.id}
            onActivate={() => activate(t.id)}
            onClose={() => closeTabSafe(t.id)}
          />
        ))}
      </div>
      <TabPane key={active.id} tab={active} />
    </div>
  )
}

function TabChip(props: {
  tab: EditorTab
  active: boolean
  onActivate: () => void
  onClose: () => void
}): JSX.Element {
  const { tab, active } = props
  const conn = useConnectionsStore((s) =>
    tab.connectionId ? s.connections.find((c) => c.id === tab.connectionId) : undefined
  )
  const open = useConnectionsStore((s) =>
    tab.connectionId ? s.openInfo[tab.connectionId] : undefined
  )
  const color = conn ? colorOf(conn.color) : null

  return (
    <div
      className={'tab-chip' + (active ? ' active' : '')}
      onClick={props.onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) props.onClose()
      }}
      title={conn ? conn.name + (conn.accessMode === 'read-only' ? ' (read-only)' : '') : 'No connection'}
      style={color && active ? { boxShadow: 'inset 0 2px 0 ' + color.value } : undefined}
    >
      {color && <span className="dot" style={{ background: color.value }} />}
      <span className="tab-title">{tab.title}</span>
      {(tab.dirty || tab.pending.length > 0) && <Circle size={7} className="dirty-dot" />}
      {tab.running && <span className="tab-running">…</span>}
      {open?.readOnly && <span className="ro-mini">RO</span>}
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          props.onClose()
        }}
        title="Close tab (Ctrl+W)"
      >
        <X size={11} />
      </button>
    </div>
  )
}

function TabPane({ tab }: { tab: EditorTab }): JSX.Element {
  const setSql = useEditorStore((s) => s.setSql)
  const loadMore = useEditorStore((s) => s.loadMore)
  const applyEdit = useEditorStore((s) => s.applyEdit)
  const saveEdits = useEditorStore((s) => s.saveEdits)
  const discardEdits = useEditorStore((s) => s.discardEdits)
  const exportResult = useEditorStore((s) => s.exportResult)
  const run = useEditorStore((s) => s.run)

  const readOnly = useConnectionsStore(
    (s) => (tab.connectionId ? s.openInfo[tab.connectionId]?.readOnly : false) ?? false
  )
  const conn = useConnectionsStore((s) =>
    tab.connectionId ? s.connections.find((c) => c.id === tab.connectionId) : undefined
  )

  return (
    <div className="tab-pane">
      {conn?.accessMode === 'read-only' && (
        <div className="readonly-banner">
          READ ONLY — {conn.name}. Data and schema modifications are disabled.
        </div>
      )}
      <div className="pane-editor">
        <SqlEditor
          tabId={tab.id}
          doc={tab.sql}
          connectionId={tab.connectionId}
          fontSize={13}
          readOnly={false}
          errorPosition={tab.error?.position}
          onChange={(doc) => setSql(tab.id, doc, true)}
          onExecute={(mode) => void run(tab.id, mode)}
        />
      </div>
      <div className="pane-result">
        <ResultTable
          tab={tab}
          readOnly={readOnly}
          onLoadMore={() => void loadMore(tab.id)}
          onApplyEdit={(rk, col, oldV, newV, pk) => applyEdit(tab.id, rk, col, oldV, newV, pk)}
          onSaveEdits={() => void saveEdits(tab.id)}
          onDiscardEdits={() => discardEdits(tab.id)}
          onExport={(fmt) => void exportResult(tab.id, fmt)}
        />
      </div>
    </div>
  )
}
