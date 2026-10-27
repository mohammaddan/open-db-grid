import { useEffect, useState } from 'react'
import {
  Table,
  Zap,
  Shield,
  Code2,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Key,
  Layers,
  ArrowLeft,
  Search
} from 'lucide-react'
import type { TableStructureInfo, BrowseTarget } from '@shared/models/explorer'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { extractApiError } from '@renderer/lib/api'

interface Props {
  tabId: string
  connectionId: string
  target: BrowseTarget
  onBackToData?: () => void
}

export function TableStructureView(props: Props): JSX.Element {
  const { tabId, connectionId, target, onBackToData } = props
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [structure, setStructure] = useState<TableStructureInfo | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'columns' | 'indexes' | 'constraints' | 'ddl'>('columns')
  const [columnFilter, setColumnFilter] = useState('')
  const [copiedDdl, setCopiedDdl] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null)

  const openBrowse = useEditorStore((s) => s.openBrowse)
  const setViewMode = useEditorStore((s) => s.setViewMode)

  const fetchStructure = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.api.explorer.structure(connectionId, target)
      setStructure(data)
    } catch (err) {
      const info = extractApiError(err)
      setError(info.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchStructure()
  }, [connectionId, target.schema, target.table])

  const copyToClipboard = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text)
      onDone()
      useUiStore.getState().pushToast('success', 'Copied to clipboard')
    } catch {
      useUiStore.getState().pushToast('error', 'Failed to copy to clipboard')
    }
  }

  const handleCopyDdl = () => {
    if (!structure?.ddl) return
    void copyToClipboard(structure.ddl, () => {
      setCopiedDdl(true)
      setTimeout(() => setCopiedDdl(false), 2000)
    })
  }

  const handleCopyIndexDef = (def: string, name: string) => {
    void copyToClipboard(def, () => {
      setCopiedIndex(name)
      setTimeout(() => setCopiedIndex(null), 2000)
    })
  }

  const handleBrowseData = () => {
    if (onBackToData) {
      onBackToData()
    } else {
      setViewMode(tabId, 'data')
      void openBrowse(connectionId, target)
    }
  }

  const filteredColumns = (structure?.columns ?? []).filter((c) => {
    const q = columnFilter.trim().toLowerCase()
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.dataType.toLowerCase().includes(q) ||
      (c.defaultValue && c.defaultValue.toLowerCase().includes(q)) ||
      (c.comment && c.comment.toLowerCase().includes(q))
    )
  })

  return (
    <div className="table-structure-view">
      {/* Top Header Bar */}
      <div className="structure-header-bar">
        <div className="structure-title-group">
          <button
            className="btn btn-back"
            onClick={handleBrowseData}
            title="Back to Data Grid"
          >
            <ArrowLeft size={13} />
            <span>Data Grid</span>
          </button>
          <div className="structure-title-text">
            <span className="structure-schema-badge">{target.schema}</span>
            <span className="structure-table-name">{target.table}</span>
            <span className="structure-kind-badge">
              {structure?.kind === 'view' ? 'VIEW' : structure?.kind === 'matview' ? 'MATVIEW' : 'TABLE'}
            </span>
          </div>
        </div>

        <div className="spacer" />

        <div className="structure-actions">
          <button
            className="btn icon-btn"
            onClick={() => void fetchStructure()}
            disabled={loading}
            title="Refresh Structure"
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            className="btn icon-btn"
            onClick={handleCopyDdl}
            disabled={!structure?.ddl}
            title="Copy CREATE TABLE DDL"
          >
            {copiedDdl ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
            <span>Copy DDL</span>
          </button>
        </div>
      </div>

      {structure?.comment && (
        <div className="structure-table-comment">
          {structure.comment}
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="structure-nav-strip">
        <button
          className={'structure-nav-tab' + (activeSubTab === 'columns' ? ' active' : '')}
          onClick={() => setActiveSubTab('columns')}
        >
          <Table size={12} />
          <span>Columns</span>
          <span className="pill">{structure?.columns.length ?? 0}</span>
        </button>
        <button
          className={'structure-nav-tab' + (activeSubTab === 'indexes' ? ' active' : '')}
          onClick={() => setActiveSubTab('indexes')}
        >
          <Zap size={12} />
          <span>Indexes</span>
          <span className="pill">{structure?.indexes.length ?? 0}</span>
        </button>
        <button
          className={'structure-nav-tab' + (activeSubTab === 'constraints' ? ' active' : '')}
          onClick={() => setActiveSubTab('constraints')}
        >
          <Shield size={12} />
          <span>Constraints</span>
          <span className="pill">
            {(structure?.constraints.length ?? 0) + (structure?.foreignKeys.length ?? 0)}
          </span>
        </button>
        <button
          className={'structure-nav-tab' + (activeSubTab === 'ddl' ? ' active' : '')}
          onClick={() => setActiveSubTab('ddl')}
        >
          <Code2 size={12} />
          <span>DDL Script</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="structure-content-body">
        {loading && !structure && (
          <div className="structure-loading">
            <Loader2 size={18} className="spin" />
            <span>Loading table structure and indexes…</span>
          </div>
        )}

        {error && (
          <div className="structure-error">
            <span>Failed to load table structure: {error}</span>
            <button className="btn" onClick={() => void fetchStructure()}>
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {structure && !loading && (
          <>
            {/* Columns Tab */}
            {activeSubTab === 'columns' && (
              <div className="structure-tab-pane">
                <div className="structure-sub-toolbar">
                  <div className="structure-search-box">
                    <Search size={12} className="search-icon" />
                    <input
                      className="structure-search-input"
                      placeholder="Filter columns by name or type…"
                      value={columnFilter}
                      onChange={(e) => setColumnFilter(e.target.value)}
                    />
                  </div>
                  <span className="structure-count-muted">
                    Showing {filteredColumns.length} of {structure.columns.length} columns
                  </span>
                </div>

                <div className="structure-table-container">
                  <table className="structure-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 45, textAlign: 'center' }}>#</th>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th style={{ width: 100 }}>Nullable</th>
                        <th>Default Value</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredColumns.map((col) => (
                        <tr key={col.name} className={col.isPk ? 'is-pk-row' : ''}>
                          <td style={{ textAlign: 'center', opacity: 0.6 }}>{col.position}</td>
                          <td>
                            <div className="col-name-wrapper">
                              {col.isPk && (
                                <span className="pk-badge" title="Primary Key">
                                  <Key size={10} /> PK
                                </span>
                              )}
                              <span className="col-name-text">{col.name}</span>
                            </div>
                          </td>
                          <td>
                            <code className="data-type-code">{col.dataType}</code>
                          </td>
                          <td>
                            <span className={'null-badge ' + (col.nullable ? 'nullable' : 'not-null')}>
                              {col.nullable ? 'NULL' : 'NOT NULL'}
                            </span>
                          </td>
                          <td>
                            {col.defaultValue ? (
                              <code className="default-val-code">{col.defaultValue}</code>
                            ) : (
                              <span className="empty-val">—</span>
                            )}
                          </td>
                          <td className="comment-cell">{col.comment ?? '—'}</td>
                        </tr>
                      ))}
                      {filteredColumns.length === 0 && (
                        <tr>
                          <td colSpan={6} className="table-empty-row">
                            No columns match &quot;{columnFilter}&quot;
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Indexes Tab */}
            {activeSubTab === 'indexes' && (
              <div className="structure-tab-pane">
                <div className="structure-table-container">
                  <table className="structure-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 220 }}>Index Name</th>
                        <th style={{ width: 120 }}>Type</th>
                        <th>Index Definition</th>
                        <th style={{ width: 70, textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structure.indexes.map((idx) => (
                        <tr key={idx.name}>
                          <td>
                            <div className="index-name-cell">
                              <Zap size={12} className="index-icon" />
                              <span className="index-name-text">{idx.name}</span>
                            </div>
                          </td>
                          <td>
                            {idx.isPrimary ? (
                              <span className="idx-tag pk">PRIMARY KEY</span>
                            ) : idx.isUnique ? (
                              <span className="idx-tag unique">UNIQUE</span>
                            ) : (
                              <span className="idx-tag standard">INDEX</span>
                            )}
                          </td>
                          <td>
                            <code className="index-def-code">{idx.definition}</code>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn icon-only small-btn"
                              title="Copy index definition"
                              onClick={() => handleCopyIndexDef(idx.definition, idx.name)}
                            >
                              {copiedIndex === idx.name ? (
                                <Check size={12} color="var(--success)" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {structure.indexes.length === 0 && (
                        <tr>
                          <td colSpan={4} className="table-empty-row">
                            No indexes found on this table.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Constraints Tab */}
            {activeSubTab === 'constraints' && (
              <div className="structure-tab-pane">
                <div className="structure-table-container">
                  <table className="structure-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 220 }}>Constraint Name</th>
                        <th style={{ width: 140 }}>Type</th>
                        <th>Definition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structure.constraints.map((con) => (
                        <tr key={con.name}>
                          <td>
                            <div className="index-name-cell">
                              <Shield size={12} className="con-icon" />
                              <span className="con-name-text">{con.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={'con-type-tag ' + con.type.toLowerCase().replace(/\s+/g, '-')}>
                              {con.type}
                            </span>
                          </td>
                          <td>
                            <code className="con-def-code">{con.definition}</code>
                          </td>
                        </tr>
                      ))}
                      {structure.constraints.length === 0 && (
                        <tr>
                          <td colSpan={3} className="table-empty-row">
                            No constraints found on this table.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* DDL Tab */}
            {activeSubTab === 'ddl' && (
              <div className="structure-tab-pane ddl-pane">
                <div className="ddl-header">
                  <span className="ddl-label">PostgreSQL DDL Definition:</span>
                  <button className="btn icon-btn" onClick={handleCopyDdl}>
                    {copiedDdl ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                    <span>{copiedDdl ? 'Copied!' : 'Copy Script'}</span>
                  </button>
                </div>
                <pre className="ddl-code-block">
                  <code>{structure.ddl}</code>
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
