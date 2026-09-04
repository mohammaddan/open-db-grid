import { Moon, Sun, ShieldCheck } from 'lucide-react'
import { useConnectionsStore } from '@renderer/state/connections'
import { useEditorStore } from '@renderer/state/editor'
import { useSettingsStore } from '@renderer/state/settings'

function formatRows(n: number | undefined): string {
  return n === undefined ? '' : n.toLocaleString('en-US')
}

export function StatusBar(): JSX.Element {
  const openInfo = useConnectionsStore((s) => s.openInfo)
  const selectedId = useConnectionsStore((s) => s.selectedId)
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const txnState = useEditorStore((s) => s.txnState)
  const theme = useSettingsStore((s) => s.settings.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  const connId = activeTab?.connectionId ?? selectedId
  const info = connId ? openInfo[connId] : undefined
  const conn = useConnectionsStore((s) => s.connections.find((c) => c.id === connId))
  const txn = connId ? txnState[connId] : undefined

  const rowCount = activeTab?.result?.page?.fetched
  const duration = activeTab?.result?.durationMs

  return (
    <div className="statusbar">
      <span className="status-item">
        {info ? (
          <>
            <span
              className="dot"
              style={{ background: conn ? colorDot(conn.id) : undefined }}
            />
            {conn?.name}
            {info.serverVersion ? ` · PG ${info.serverVersion}` : ''}
          </>
        ) : conn ? (
          <>{conn.name} (not connected)</>
        ) : (
          'No connection'
        )}
      </span>
      {conn?.accessMode === 'read-only' && (
        <span className="status-item readonly">
          <ShieldCheck size={11} /> READ ONLY
        </span>
      )}
      {conn?.production && <span className="status-item prod">PRODUCTION</span>}
      {txn === 'open' && <span className="status-item txn">● TRANSACTION OPEN</span>}
      <span className="spacer" />
      {activeTab?.running && <span className="status-item running">Running…</span>}
      {rowCount !== undefined && (
        <span className="status-item">{formatRows(rowCount)} rows</span>
      )}
      {duration !== undefined && <span className="status-item">{duration} ms</span>}
      <button
        className="status-item theme-toggle"
        title="Toggle theme"
        onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
      </button>
    </div>
  )
}

/** color lookup helper (avoids importing the whole model into hot paths) */
function colorDot(connectionId: string): string {
  const conn = useConnectionsStore
    .getState()
    .connections.find((c) => c.id === connectionId)
  if (!conn) return 'var(--accent)'
  // value colors are defined in CONNECTION_COLORS; map by id
  const palette: Record<string, string> = {
    slate: '#94a3b8', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
    green: '#22c55e', teal: '#14b8a6', blue: '#3b82f6', purple: '#a855f7',
    pink: '#ec4899'
  }
  return palette[conn.color] ?? palette.slate
}
