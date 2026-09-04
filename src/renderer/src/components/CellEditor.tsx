// Type-aware cell rendering and editing for the result grid.
// Editing only ever mutates the pending-changes model — nothing is written
// to the database until the user presses "Save changes".

import { useEffect, useRef, useState } from 'react'
import type { RenderCellProps, RenderEditCellProps } from 'react-data-grid'
import type { ResultRow } from '@shared/models/result'

/** OIDs for type-aware editing (informational; server casts parameters anyway). */
export const JSON_OIDS = new Set([114, 3802])
const BOOLEAN_OIDS = new Set([16])
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700, 790])

export function isJsonType(dataType: string, typeOid?: number): boolean {
  if (typeOid !== undefined && JSON_OIDS.has(typeOid)) return true
  return /^(json|jsonb)$/i.test(dataType)
}

export function isBooleanType(dataType: string, typeOid?: number): boolean {
  return typeOid !== undefined ? BOOLEAN_OIDS.has(typeOid) : /^boolean$/i.test(dataType)
}

export function isNumericType(dataType: string, typeOid?: number): boolean {
  if (typeOid !== undefined) return NUMERIC_OIDS.has(typeOid)
  return /(int|numeric|decimal|real|double|money)/i.test(dataType)
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Long values are truncated in the grid; the full value is one click away. */
const CELL_PREVIEW_LIMIT = 120

export function ValueCell(
  props: RenderCellProps<ResultRow> & { onOpenValue?: (rowKey: number, column: string) => void }
): JSX.Element {
  const { row, column, onOpenValue } = props
  const value = row[column.key]
  const rowKey = row.__rowId

  if (value === null || value === undefined) {
    return <span className="cell-null">NULL</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'cell-true' : 'cell-false'}>{String(value)}</span>
  }
  if (typeof value === 'object') {
    return (
      <span
        className="cell-json"
        onClick={() => onOpenValue?.(rowKey, column.key)}
        title="Open JSON viewer"
      >
        {formatCell(value)}
      </span>
    )
  }
  const text = String(value)
  if (text.length > CELL_PREVIEW_LIMIT || text.includes('\n')) {
    return (
      <span
        className="cell-long"
        onClick={() => onOpenValue?.(rowKey, column.key)}
        title="Open value viewer"
      >
        {text.slice(0, CELL_PREVIEW_LIMIT).replace(/\n/g, '↵')}…
      </span>
    )
  }
  return <span className="cell-text">{text}</span>
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

export function TextEditor(
  props: RenderEditCellProps<ResultRow> & { longText?: boolean }
): JSX.Element {
  const { row, column, onRowChange, onClose } = props
  const initial = row[column.key]
  const [text, setText] = useState<string>(
    initial === null || initial === undefined ? '' : String(initial)
  )
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void =>
    onRowChange({ ...row, [column.key]: text === '' ? '' : text }, true)

  if (props.longText) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        className="cell-editor area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
          if (e.key === 'Escape') onClose(false)
          e.stopPropagation()
        }}
      />
    )
  }
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      className="cell-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onRowChange({ ...row, [column.key]: text }, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onClose(false)
        e.stopPropagation()
      }}
    />
  )
}

export function NumericEditor(props: RenderEditCellProps<ResultRow>): JSX.Element {
  const { row, column, onRowChange, onClose } = props
  const initial = row[column.key]
  const [text, setText] = useState<string>(
    initial === null || initial === undefined ? '' : String(initial)
  )
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    if (text.trim() === '') {
      onRowChange({ ...row, [column.key]: null }, true)
      return
    }
    const num = Number(text)
    onRowChange({ ...row, [column.key]: Number.isFinite(num) ? num : text }, true)
  }

  return (
    <input
      ref={ref}
      className="cell-editor"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onClose(false)
        e.stopPropagation()
      }}
    />
  )
}

export function BooleanEditor(props: RenderEditCellProps<ResultRow>): JSX.Element {
  const { row, column, onRowChange, onClose } = props
  const current = row[column.key]
  const ref = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <select
      ref={ref}
      className="cell-editor select"
      value={current === null || current === undefined ? '' : current ? 'true' : 'false'}
      onChange={(e) => {
        const v = e.target.value
        onRowChange({ ...row, [column.key]: v === '' ? null : v === 'true' }, true)
      }}
      onBlur={() => onClose(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onRowChange({ ...row }, true)
        if (e.key === 'Escape') onClose(false)
        e.stopPropagation()
      }}
    >
      <option value="">NULL</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  )
}

export function JsonEditor(props: RenderEditCellProps<ResultRow>): JSX.Element {
  const { row, column, onRowChange, onClose } = props
  const initial = row[column.key]
  const [text, setText] = useState<string>(
    initial === null || initial === undefined ? '' : formatCell(initial)
  )
  const [invalid, setInvalid] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const commit = (): void => {
    if (text.trim() === '') {
      onRowChange({ ...row, [column.key]: null }, true)
      return
    }
    try {
      const parsed = JSON.parse(text)
      setInvalid(false)
      onRowChange({ ...row, [column.key]: parsed }, true)
    } catch {
      setInvalid(true)
    }
  }

  return (
    <textarea
      ref={ref}
      className={'cell-editor area' + (invalid ? ' invalid' : '')}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
        if (e.key === 'Escape') onClose(false)
        e.stopPropagation()
      }}
      onBlur={commit}
      title={invalid ? 'Invalid JSON' : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Value viewer modal (JSON / long text)
// ---------------------------------------------------------------------------

export function ValueViewerModal(props: {
  value: unknown
  dataType: string
  onClose: () => void
}): JSX.Element {
  const { value, dataType, onClose } = props
  const pretty =
    value !== null && typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : value === null || value === undefined
        ? 'NULL'
        : String(value)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal value-viewer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Value ({dataType})
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <textarea readOnly className="value-viewer-text" value={pretty} />
      </div>
    </div>
  )
}

