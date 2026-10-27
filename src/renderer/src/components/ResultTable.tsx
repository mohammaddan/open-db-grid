// Spreadsheet-like result grid built on react-data-grid (virtualized:
// 1M-row cursors never enter the DOM). Editing routes through the
// pending-changes model — cells only change after "Save changes".
// Styled according to Concept 1: Obsidian Cyber Dark.

import { useMemo, useState } from 'react'
import {
  DataGrid,
  SelectColumn,
  type Column,
  type SortColumn,
  type RenderEditCellProps,
  type CellMouseArgs
} from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import {
  Check,
  X,
  Search,
  Download,
  Copy,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2
} from 'lucide-react'
import { useEditorStore, type EditorTab } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import type { PendingEdit, QueryColumn } from '@shared/models/explorer'
import type { ResultRow } from '@shared/models/result'
import {
  ValueCell,
  TextEditor,
  NumericEditor,
  BooleanEditor,
  JsonEditor,
  ValueViewerModal,
  isJsonType,
  isBooleanType,
  isNumericType,
  formatCell
} from './CellEditor'
import { useSettingsStore } from '@renderer/state/settings'

interface Props {
  tab: EditorTab
  readOnly: boolean
  onLoadMore: () => void
  onApplyEdit: (
    rowKey: number,
    column: string,
    oldValue: unknown,
    newValue: unknown,
    pkValues: Array<{ column: string; value: unknown }>
  ) => void
  onSaveEdits: () => void
  onDiscardEdits: () => void
  onExport: (format: 'csv' | 'json' | 'tsv') => void
}

interface ValueViewer {
  value: unknown
  dataType: string
}

export function ResultTable(props: Props): JSX.Element {
  const { tab, readOnly } = props
  const settings = useSettingsStore((s) => s.settings)
  const allowEditing = settings.editor.allowResultEditing && !readOnly

  const [widths, setWidths] = useState<Record<string, number>>({})
  const [order, setOrder] = useState<string[] | null>(null)
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([])
  const [filter, setFilter] = useState('')
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(new Set())
  const [lastCell, setLastCell] = useState<{ row: ResultRow; key: string } | null>(null)
  const [viewer, setViewer] = useState<ValueViewer | null>(null)
  const [jumpInput, setJumpInput] = useState('')

  const goToPage = useEditorStore((s) => s.goToPage)
  const changePageSize = useEditorStore((s) => s.changePageSize)

  const page = tab.result?.page ?? null
  const resultColumns: QueryColumn[] = page?.columns ?? tab.result?.columns ?? []

  const pageNumber = tab.pageNumber ?? 1
  const pageSize = tab.pageSize ?? 500
  const totalRows = tab.result?.totalRows ?? page?.totalRows
  const totalPages = totalRows !== undefined ? Math.max(1, Math.ceil(totalRows / pageSize)) : undefined
  const hasMore = tab.hasMore || (totalPages !== undefined && pageNumber < totalPages)
  const canGoPrev = pageNumber > 1 && !tab.running
  const canGoNext = hasMore && !tab.running
  const showPagination = (totalRows !== undefined && totalRows > pageSize) || tab.hasMore || pageNumber > 1

  const handlePageChange = (targetPage: number) => {
    if (tab.pending.length > 0) {
      useUiStore.getState().requestConfirm({
        title: 'Unsaved Changes',
        message: `You have ${tab.pending.length} pending change(s) on this page. Leaving this page will discard them.`,
        confirmLabel: 'Discard & Change Page',
        danger: true,
        onConfirm: () => {
          props.onDiscardEdits()
          void goToPage(tab.id, targetPage, pageSize)
        }
      })
      return
    }
    void goToPage(tab.id, targetPage, pageSize)
  }

  const handleJumpSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const p = parseInt(jumpInput, 10)
    if (Number.isFinite(p) && p >= 1) {
      const target = totalPages !== undefined ? Math.min(p, totalPages) : p
      handlePageChange(target)
      setJumpInput('')
    }
  }

  const handleSizeChange = (newSize: number) => {
    if (newSize === pageSize) return
    if (tab.pending.length > 0) {
      useUiStore.getState().requestConfirm({
        title: 'Unsaved Changes',
        message: `You have ${tab.pending.length} pending change(s) on this page. Changing page size will discard them.`,
        confirmLabel: 'Discard & Change',
        danger: true,
        onConfirm: () => {
          props.onDiscardEdits()
          void changePageSize(tab.id, newSize)
        }
      })
      return
    }
    void changePageSize(tab.id, newSize)
  }

  const orderedColumns = useMemo(() => {
    const names = resultColumns.map((c) => c.name)
    if (!order) return names
    const known = order.filter((k) => names.includes(k))
    const added = names.filter((k) => !known.includes(k))
    return [...known, ...added]
  }, [resultColumns, order])

  // base rows -> filter -> client-side sort (loaded pages only)
  const baseRows = useMemo(() => {
    let rows = page?.rows ?? []
    const q = filter.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) =>
        Object.keys(r).some((k) => {
          if (k === '__rowId') return false
          const v = r[k]
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q)
        })
      )
    }
    if (sortColumns.length > 0) {
      const { columnKey, direction } = sortColumns[0]
      const cmp = (a: ResultRow, b: ResultRow): number => {
        const av = a[columnKey]
        const bv = b[columnKey]
        if (av === bv) return 0
        if (av === null || av === undefined) return -1
        if (bv === null || bv === undefined) return 1
        if (typeof av === 'number' && typeof bv === 'number') return av - bv
        return String(av).localeCompare(String(bv))
      }
      rows = [...rows].sort((a, b) => (direction === 'DESC' ? -cmp(a, b) : cmp(a, b)))
    }
    return rows
  }, [page?.rows, filter, sortColumns])

  // overlay pending edits for display (the store rows stay pristine)
  const displayRows = useMemo(() => {
    if (tab.pending.length === 0) return baseRows
    const byRow = new Map<number, PendingEdit[]>()
    for (const p of tab.pending) {
      const list = byRow.get(p.rowKey) ?? []
      list.push(p)
      byRow.set(p.rowKey, list)
    }
    if (byRow.size === 0) return baseRows
    return baseRows.map((r) => {
      const edits = byRow.get(r.__rowId)
      if (!edits) return r
      const out = { ...r }
      for (const e of edits) out[e.column] = e.newValue
      return out
    })
  }, [baseRows, tab.pending])

  const pendingCells = useMemo(() => {
    const set = new Set<string>()
    for (const p of tab.pending) set.add(p.rowKey + ':' + p.column)
    return set
  }, [tab.pending])

  const planEditable = tab.plan?.editable === true && allowEditing

  const columns: Column<ResultRow>[] = useMemo(() => {
    const cols: Column<ResultRow>[] = [
      {
        ...SelectColumn,
        width: 36,
        maxWidth: 36,
        resizable: false,
        sortable: false
      }
    ]
    for (const name of orderedColumns) {
      const qc = resultColumns.find((c) => c.name === name)
      const planCol = tab.plan?.columns.find((c) => c.key === name)
      const editable = planEditable && (planCol?.editable ?? false)
      const isBool = isBooleanType(qc?.dataType ?? '', qc?.typeOid)
      const isJson = isJsonType(qc?.dataType ?? '', qc?.typeOid)
      const isNum = isNumericType(qc?.dataType ?? '', qc?.typeOid)
      const isPk = tab.plan?.pkColumns.includes(name) ?? false
      const rawType = qc?.dataType ?? ''
      const displayType =
        rawType && !rawType.startsWith('oid:')
          ? rawType
          : isNum
          ? 'NUMERIC'
          : isBool
          ? 'BOOLEAN'
          : isJson
          ? 'JSON'
          : ''

      cols.push({
        key: name,
        name,
        width: widths[name] ?? undefined,
        minWidth: 70,
        resizable: true,
        sortable: true,
        draggable: true,
        editable,
        cellClass: (row: ResultRow): string =>
          pendingCells.has(row.__rowId + ':' + name) ? 'cell-pending' : '',
        renderHeaderCell: () => (
          <div className="grid-header-cell">
            <span className="grid-header-title" title={name}>
              {name}
            </span>
            <div className="grid-header-badges">
              {isPk && (
                <span className="badge-pk" title="Primary Key">
                  PK
                </span>
              )}
              {displayType && (
                <span className="badge-type" title={rawType || displayType}>
                  {displayType.slice(0, 9)}
                </span>
              )}
            </div>
          </div>
        ),
        renderCell: (p) => <ValueCell {...p} onOpenValue={(rk, ck) => openViewer(rk, ck)} />,
        renderEditCell: (p: RenderEditCellProps<ResultRow>) =>
          wrapEditor(p, isBool, isJson, isNum)
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedColumns, resultColumns, widths, pendingCells, planEditable, tab.plan])

  function openViewer(rowKey: number, columnKey: string): void {
    const row = (page?.rows ?? []).find((r) => r.__rowId === rowKey)
    if (!row) return
    const qc = resultColumns.find((c) => c.name === columnKey)
    setViewer({ value: row[columnKey], dataType: qc?.dataType ?? '' })
  }

  /** Editors report through onRowChange — we redirect that into the pending model. */
  function wrapEditor(
    p: RenderEditCellProps<ResultRow>,
    isBool: boolean,
    isJson: boolean,
    isNum: boolean
  ): JSX.Element {
    const key = p.column.key
    const shared: RenderEditCellProps<ResultRow> = {
      ...p,
      onRowChange: (row: ResultRow) => {
        const oldValue = p.row[key]
        const newValue = row[key]
        if (newValue === oldValue) return
        const pkValues = (tab.plan?.pkColumns ?? []).map((pk) => ({
          column: pk,
          value: p.row[pk]
        }))
        props.onApplyEdit(p.row.__rowId, key, oldValue, newValue, pkValues)
      }
    }
    if (isBool) return <BooleanEditor {...shared} />
    if (isJson) return <JsonEditor {...shared} />
    if (isNum) return <NumericEditor {...shared} />
    return <TextEditor {...shared} />
  }

  // -- clipboard helpers -----------------------------------------------------

  function copyText(text: string): void {
    void navigator.clipboard.writeText(text)
  }

  function copyCell(): void {
    if (!lastCell) return
    copyText(formatCell(lastCell.row[lastCell.key]))
  }

  function copyRow(): void {
    if (!lastCell) return
    const values = orderedColumns.map((k) =>
      lastCell.row[k] === null ? 'NULL' : String(lastCell.row[k] ?? '')
    )
    copyText(values.join('\t'))
  }

  function copySelectedRows(): void {
    if (selectedRows.size === 0) return
    const header = orderedColumns.join('\t')
    const lines = displayRows
      .filter((r) => selectedRows.has(r.__rowId))
      .map((r) =>
        orderedColumns
          .map((k) => (r[k] === null ? 'NULL' : String(r[k] ?? '')))
          .join('\t')
      )
    copyText([header, ...lines].join('\n'))
  }

  // -- render -----------------------------------------------------------------

  const fetched = page?.fetched ?? 0
  const duration = tab.result?.durationMs ?? 0
  const rowsText =
    totalRows !== undefined && tab.hasMore && fetched < totalRows
      ? `${totalRows.toLocaleString()} rows (${fetched.toLocaleString()} loaded)`
      : totalRows !== undefined
      ? `${totalRows.toLocaleString()} rows`
      : tab.hasMore
      ? `${fetched.toLocaleString()}+ rows`
      : `${fetched.toLocaleString()} rows`

  const kindLabel =
    tab.result?.kind === 'DML'
      ? tab.result.rowsAffected !== undefined
        ? tab.result.rowsAffected.toLocaleString() + ' rows affected'
        : 'done'
      : `${duration} ms • ${rowsText}`

  return (
    <div className="result-pane">
      <div className="result-toolbar">
        <span className={'result-status ' + (tab.error ? 'error' : 'ok')}>
          {tab.error ? 'Error' : 'Completed'}
        </span>
        <span className="result-meta">{kindLabel}</span>

        {tab.hasMore && (
          <button
            className="btn icon-only"
            onClick={props.onLoadMore}
            title="Fetch the next page from cursor"
          >
            <RefreshCw size={12} />
          </button>
        )}
        {tab.hasMore && (
          <span className="result-meta muted">
            {totalRows !== undefined
              ? `showing ${fetched.toLocaleString()} of ${totalRows.toLocaleString()}`
              : `showing ${fetched.toLocaleString()} of more`}
          </span>
        )}

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: 7, color: 'var(--fg-dim)', pointerEvents: 'none' }} />
          <input
            className="result-search"
            style={{ paddingLeft: 24 }}
            placeholder="Search in results…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="spacer" />

        {tab.plan && !tab.plan.editable && (
          <span className="result-readonly" title={tab.plan.reason ?? ''}>
            Read-Only Result
          </span>
        )}
        {planEditable && tab.pending.length === 0 && (
          <span className="result-editable">Editable</span>
        )}

        <button className="btn" onClick={copyCell} disabled={!lastCell} title="Copy cell">
          <Copy size={12} /> Cell
        </button>
        <button className="btn" onClick={copyRow} disabled={!lastCell} title="Copy row (TSV)">
          <Copy size={12} /> Row
        </button>
        {selectedRows.size > 0 && (
          <button className="btn" onClick={copySelectedRows} title={`Copy ${selectedRows.size} selected rows`}>
            <Copy size={12} /> Rows ({selectedRows.size})
          </button>
        )}

        <div className="sep" />

        <button
          className="btn"
          onClick={() => props.onExport('csv')}
          disabled={!tab.result?.sessionId}
          title="Export CSV"
        >
          <Download size={12} /> CSV
        </button>
        <button
          className="btn"
          onClick={() => props.onExport('json')}
          disabled={!tab.result?.sessionId}
          title="Export JSON"
        >
          <Download size={12} /> JSON
        </button>
        <button
          className="btn"
          onClick={() => props.onExport('tsv')}
          disabled={!tab.result?.sessionId}
          title="Export TSV"
        >
          <Download size={12} /> TSV
        </button>
      </div>

      {tab.error && <div className="result-error">{tab.error.message}</div>}

      {page ? (
        <DataGrid
          className="result-grid rdg"
          columns={columns}
          rows={displayRows}
          rowKeyGetter={(r) => r.__rowId}
          selectedRows={selectedRows}
          onSelectedRowsChange={(rows: ReadonlySet<number>) => setSelectedRows(rows)}
          sortColumns={sortColumns}
          onSortColumnsChange={setSortColumns}
          onColumnResize={(c, w) => setWidths((prev) => ({ ...prev, [c.key]: w }))}
          onColumnsReorder={(source, target) =>
            setOrder((prev) => {
              const cur = prev ?? orderedColumns
              const from = cur.indexOf(source)
              const to = cur.indexOf(target)
              if (from < 0 || to < 0) return prev
              const next = [...cur]
              next.splice(to, 0, next.splice(from, 1)[0])
              return next
            })
          }
          onCellClick={(args: CellMouseArgs<ResultRow>) => {
            if (args.row && args.column) setLastCell({ row: args.row, key: args.column.key })
          }}
          onCellKeyDown={(args, event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
              const { row, column } = args
              if (!row || !column) return
              setLastCell({ row, key: column.key })
              copyText(formatCell(row[column.key]))
            }
          }}
          defaultColumnOptions={{ resizable: true }}
          rowHeight={27}
          headerRowHeight={30}
          enableVirtualization
        />
      ) : (
        <div className="result-empty">No results — run a query to display rows here.</div>
      )}

      {/* Modern Obsidian Cyber Pagination Dock */}
      {page && (
        <div className="grid-pagination-bar">
          <div className="pagination-info">
            <span className="pagination-range">
              {totalRows !== undefined ? (
                <>
                  Showing{' '}
                  <span className="hl">
                    {Math.min((pageNumber - 1) * pageSize + 1, totalRows).toLocaleString()}–
                    {Math.min(pageNumber * pageSize, totalRows).toLocaleString()}
                  </span>{' '}
                  of <span className="hl">{totalRows.toLocaleString()}</span> rows
                </>
              ) : (
                <>
                  Showing{' '}
                  <span className="hl">
                    {((pageNumber - 1) * pageSize + 1).toLocaleString()}–
                    {((pageNumber - 1) * pageSize + page.rows.length).toLocaleString()}
                  </span>{' '}
                  rows
                </>
              )}
            </span>
            <span className="pagination-dot">•</span>
            <span className="pagination-duration">{duration} ms</span>
          </div>

          <div className="spacer" />

          {/* Navigation controls if table has more rows or multi-page */}
          {showPagination ? (
            <div className="pagination-controls">
              <div className="pagination-nav-strip">
                <button
                  className="page-btn"
                  title="First page"
                  disabled={!canGoPrev}
                  onClick={() => handlePageChange(1)}
                >
                  <ChevronsLeft size={13} />
                </button>
                <button
                  className="page-btn"
                  title="Previous page"
                  disabled={!canGoPrev}
                  onClick={() => handlePageChange(pageNumber - 1)}
                >
                  <ChevronLeft size={13} />
                </button>

                <div className="page-indicator">
                  <span className="page-label">Page</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages ?? 999999}
                    className="page-num-input"
                    value={pageNumber}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (Number.isFinite(val) && val >= 1) {
                        handlePageChange(val)
                      }
                    }}
                  />
                  <span className="page-total">
                    of {totalPages !== undefined ? totalPages.toLocaleString() : '?'}
                  </span>
                </div>

                <button
                  className="page-btn"
                  title="Next page"
                  disabled={!canGoNext}
                  onClick={() => handlePageChange(pageNumber + 1)}
                >
                  <ChevronRight size={13} />
                </button>
                {totalPages !== undefined && (
                  <button
                    className="page-btn"
                    title="Last page"
                    disabled={pageNumber >= totalPages || tab.running}
                    onClick={() => handlePageChange(totalPages)}
                  >
                    <ChevronsRight size={13} />
                  </button>
                )}
              </div>

              <div className="pagination-sep" />

              <form onSubmit={handleJumpSubmit} className="pagination-jump-form">
                <span className="jump-label">Go to</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages ?? 999999}
                  className="jump-input"
                  placeholder="#"
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                />
                <button
                  type="submit"
                  className="jump-btn"
                  disabled={!jumpInput || tab.running}
                  title="Go to specific page"
                >
                  Go
                </button>
              </form>

              <div className="pagination-sep" />

              <select
                className="pagination-size-select"
                value={pageSize}
                onChange={(e) => handleSizeChange(Number(e.target.value))}
                title="Rows per page"
              >
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={250}>250 / page</option>
                <option value={500}>500 / page</option>
                <option value={1000}>1,000 / page</option>
              </select>

              {tab.running && <Loader2 size={12} className="spin pagination-spinner" />}
            </div>
          ) : (
            <div className="pagination-controls single">
              <span className="pagination-single-label">All rows loaded (Page 1 of 1)</span>
              <select
                className="pagination-size-select"
                value={pageSize}
                onChange={(e) => handleSizeChange(Number(e.target.value))}
                title="Rows per page"
              >
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={250}>250 / page</option>
                <option value={500}>500 / page</option>
                <option value={1000}>1,000 / page</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Concept 1 Obsidian Cyber Pending Changes Dock */}
      {tab.pending.length > 0 && (
        <div className="pending-dock">
          <span className="pending-count">
            <span className="dot" style={{ background: 'var(--warning)', boxShadow: '0 0 6px var(--warning)' }} />
            {tab.pending.length} Pending Change{tab.pending.length === 1 ? '' : 's'}
          </span>
          <button
            className="btn primary cyber-btn"
            onClick={props.onSaveEdits}
            title="Apply pending changes (parameterized UPDATE)"
          >
            <Check size={13} /> Save Changes
          </button>
          <button className="btn" onClick={props.onDiscardEdits} title="Discard all pending changes">
            <X size={13} /> Discard
          </button>
          <div className="spacer" />
          <span className="result-meta muted">
            {duration} ms • {rowsText}
          </span>
        </div>
      )}

      {viewer && (
        <ValueViewerModal
          value={viewer.value}
          dataType={viewer.dataType}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}
