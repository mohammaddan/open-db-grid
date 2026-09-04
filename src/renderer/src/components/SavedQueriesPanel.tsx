import { useEffect, useState } from 'react'
import { X, Trash2, FolderOpen } from 'lucide-react'
import type { SavedQuery } from '@shared/models/history'
import { useUiStore } from '@renderer/state/ui'
import { useEditorStore } from '@renderer/state/editor'
import { useConnectionsStore } from '@renderer/state/connections'

export function SavedQueriesPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.savedOpen)
  const close = useUiStore((s) => s.closeSaved)
  const [queries, setQueries] = useState<SavedQuery[]>([])
  const connections = useConnectionsStore((s) => s.connections)

  useEffect(() => {
    if (!open) return
    void window.api.saved.list().then(setQueries).catch(() => setQueries([]))
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Saved Queries
          <span className="spacer" />
          <button className="btn" onClick={close}><X size={12} /></button>
        </div>
        <div className="modal-list">
          {queries.map((q) => {
            const conn = connections.find((c) => c.id === q.connectionId)
            return (
              <div key={q.id} className="history-row">
                <div className="history-sql">{q.name}</div>
                <div className="history-meta">
                  {conn && <span>{conn.name}</span>}
                  <span>{new Date(q.updatedAt).toLocaleDateString('en-US')}</span>
                </div>
                <div className="history-actions">
                  <button
                    className="icon-btn"
                    title="Open in new tab"
                    onClick={() => {
                      useEditorStore.getState().newQueryTab(q.connectionId ?? null, q.sql)
                      close()
                    }}
                  >
                    <FolderOpen size={12} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete"
                    onClick={() =>
                      void window.api.saved.remove(q.id).then(() =>
                        setQueries((prev) => prev.filter((x) => x.id !== q.id))
                      )
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
          {queries.length === 0 && <div className="result-empty">No saved queries yet.</div>}
        </div>
      </div>
    </div>
  )
}
