// Spreadsheet-like result grid built on react-data-grid (virtualized:
// 1M-row cursors never enter the DOM). Editing routes through the
// pending-changes model — cells only change after "Save changes".

import { useMemo, useState } from 'react'
import { DataGrid,
  SelectColumn,
  type Column,
  type SortColumn,
  type RenderEditCellProps,
  type CellKeyDownArgs,
  type CellMouseArgs
} from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import type { EditorTab } from '@renderer/state/editor'
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

  const page = tab.result?.page ?? null
  const resultColumns: QueryColumn[] = page?.columns ?? tab.result?.columns ?? []

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
      cols.push({
        key: name,
        name,
        width: widths[name] ?? undefined,
        minWidth: 60,
        resizable: true,
        sortable: true,
        draggable: true,
        editable,
        cellClass: (row: ResultRow): string =>
          pendingCells.has(row.__rowId + ':' + name) ? 'cell-pending' : '',
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
    const values = orderedColumns.map((k) => (lastCell.row[k] === null ? 'NULL' : String(lastCell.row[k] ?? '')))
    copyText(values.join('\t'))
  }

  function copySelectedRows(): void {
    if (selectedRows.size === 0) return
    const header = orderedColumns.join('\t')
    const lines = displayRows
      .filter((r) => selectedRows.has(r.__rowId))
      .map((r) => orderedColumns.map((k) => (r[k] === null ? 'NULL' : String(r[k] ?? ''))).join('\t'))
    copyText([header, ...lines].join('\n'))
  }

  // -- render -----------------------------------------------------------------

  const fetched = page?.fetched ?? 0
  const duration = tab.result?.durationMs ?? 0
  const kindLabel =
    tab.result?.kind === 'DML'
      ? tab.result.rowsAffected !== undefined
        ? tab.result.rowsAffected.toLocaleString() + ' rows affected'
        : 'done'
      : fetched.toLocaleString() + ' rows'

  return (
    <div className="result-pane">
      <div className="result-toolbar">
        <span className={'result-status ' + (tab.error ? 'error' : 'ok')}>
          {tab.error ? 'error' : 'completed'}
        </span>
        <span className="result-meta">{kindLabel}</span>
        <span className="result-meta">{duration} ms</span>
        {tab.hasMore && (
          <button className="btn" onClick={props.onLoadMore} title="Fetch the next page from the cursor">
            Load more…
          </button>
        )}
        {tab.hasMore && (
          <span className="result-meta muted">showing {fetched.toLocaleString()} of more</span>
        )}

        <input
          className="result-search"
          placeholder="Search results…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="spacer" />

        {tab.plan && !tab.plan.editable && (
          <span className="result-readonly" title={tab.plan.reason ?? ''}>
            result read-only
          </span>
        )}
        {planEditable && tab.pending.length === 0 && (
          <span className="result-editable">editable</span>
        )}
        {tab.pending.length > 0 && (
          <>
            <span className="pending-count">
              {tab.pending.length} pending change{tab.pending.length === 1 ? '' : 's'}
            </span>
            <button className="btn primary" onClick={props.onSaveEdits} title="Apply pending changes (parameterized UPDATE)">
              Save changes
            </button>
            <button className="btn" onClick={props.onDiscardEdits}>Discard</button>
          </>
        )}
        <button className="btn" onClick={copyCell} disabled={!lastCell} title="Copy cell">Copy cell</button>
        <button className="btn" onClick={copyRow} disabled={!lastCell} title="Copy row (TSV)">Copy row</button>
        <button
          className="btn"
          onClick={copySelectedRows}
          disabled={selectedRows.size === 0}
          title={'Copy selected rows (' + selectedRows.size + ')'}
        >
          Copy rows
        </button>
        <button className="btn" onClick={() => props.onExport('csv')} disabled={!tab.result?.sessionId}>CSV</button>
        <button className="btn" onClick={() => props.onExport('json')} disabled={!tab.result?.sessionId}>JSON</button>
        <button className="btn" onClick={() => props.onExport('tsv')} disabled={!tab.result?.sessionId}>TSV</button>
      </div>

      {tab.error && <div className="result-error">{tab.error.message}</div>}

      {page ? (
        <DataGrid
          className="result-grid"
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
          rowHeight={26}
          headerRowHeight={28}
          enableVirtualization
        />
      ) : (
        <div className="result-empty">No results — run a query to see rows here.</div>
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
