import { useEffect, useMemo, useState } from 'react'
import { Copy, Play, Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/models/history'
import { useUiStore } from '@renderer/state/ui'
import { useEditorStore } from '@renderer/state/editor'
import { useConnectionsStore } from '@renderer/state/connections'
import { copyText } from '@renderer/lib/clipboard'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export function QueryHistoryPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.historyOpen)
  const close = useUiStore((s) => s.closeHistory)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState('')
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const openInfo = useConnectionsStore((s) => s.openInfo)

  useEffect(() => {
    if (!open) return
    void window.api.history
      .list(activeTab?.connectionId ?? undefined)
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [open, activeTab?.connectionId])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.sql.toLowerCase().includes(q) || e.connectionName.toLowerCase().includes(q)
    )
  }, [entries, filter])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Query History
          {activeTab?.connectionId && openInfo[activeTab.connectionId] === undefined && (
            <span className="hint"> · this connection</span>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => void window.api.history.clear(activeTab?.connectionId ?? undefined).then(() => setEntries([]))}>
            <Trash2 size={12} /> Clear
          </button>
          <button className="btn" onClick={close}><X size={12} /></button>
        </div>
        <input
          className="panel-search"
          placeholder="Search history…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
        <div className="modal-list">
          {filtered.map((e) => (
            <div key={e.id} className={'history-row' + (e.success ? '' : ' failed')}>
              <div className="history-sql">{e.sql.length > 160 ? e.sql.slice(0, 160) + '…' : e.sql}</div>
              <div className="history-meta">
                <span>{fmtTime(e.executedAt)}</span>
                <span>{e.connectionName}</span>
                {e.durationMs !== undefined && <span>{e.durationMs} ms</span>}
                {e.resultCount !== undefined && <span>{e.resultCount.toLocaleString('en-US')} rows</span>}
                <span className={'badge ' + (e.success ? 'ok' : 'err')}>
                  {e.success ? e.kind : e.errorMessage ?? 'error'}
                </span>
              </div>
              <div className="history-actions">
                <button
                  className="icon-btn"
                  title="Re-run in new tab"
                  onClick={() => {
                    useEditorStore.getState().newQueryTab(e.connectionId, e.sql)
                    close()
                  }}
                >
                  <Play size={12} />
                </button>
                <button className="icon-btn" title="Copy SQL" onClick={() => void copyText(e.sql)}>
                  <Copy size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="Delete entry"
                  onClick={() =>
                    void window.api.history.remove(e.id).then(() =>
                      setEntries((prev) => prev.filter((x) => x.id !== e.id))
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="result-empty">No history entries.</div>}
        </div>
      </div>
    </div>
  )
}
