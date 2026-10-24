// Type-aware cell rendering and editing for the result grid.
// Editing only ever mutates the pending-changes model — nothing is written
// to the database until the user presses "Save changes".

import { useEffect, useMemo, useRef, useState } from 'react'
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

import { Copy, Check, FileJson, X, AlignLeft } from 'lucide-react'

// ---------------------------------------------------------------------------
// Value viewer modal (JSON / long text)
// ---------------------------------------------------------------------------

export function ValueViewerModal(props: {
  value: unknown
  dataType: string
  onClose: () => void
}): JSX.Element {
  const { value, dataType, onClose } = props
  const [copied, setCopied] = useState(false)
  const [formatMode, setFormatMode] = useState<'pretty' | 'compact'>('pretty')

  const isJson = isJsonType(dataType) || (value !== null && typeof value === 'object')

  // Parse if string containing JSON
  const parsedJson = useMemo(() => {
    if (value !== null && typeof value === 'object') return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.parse(trimmed)
        } catch {
          return null
        }
      }
    }
    return null
  }, [value])

  const displayText = useMemo(() => {
    if (value === null || value === undefined) return 'NULL'
    if (parsedJson !== null) {
      return formatMode === 'pretty'
        ? JSON.stringify(parsedJson, null, 2)
        : JSON.stringify(parsedJson)
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }, [value, parsedJson, formatMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // fallback
    }
  }

  const lineCount = displayText.split('\n').length
  const charCount = displayText.length

  return (
    <div className="modal-backdrop value-viewer-backdrop" onMouseDown={onClose}>
      <div className="modal value-viewer value-viewer-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="value-viewer-header">
          <div className="value-viewer-title-group">
            <span className="value-viewer-title">
              {isJson ? <FileJson size={16} className="text-cyan-400" /> : <AlignLeft size={16} />}
              <span>Cell Value</span>
            </span>
            <span className="value-viewer-badge">{dataType}</span>
            {parsedJson !== null && <span className="value-viewer-badge json-badge">Valid JSON</span>}
            <span className="value-viewer-stats">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'} · {charCount} chars
            </span>
          </div>

          <div className="value-viewer-actions">
            {parsedJson !== null && (
              <button
                type="button"
                className="btn secondary cyber-btn"
                style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                onClick={() => setFormatMode((m) => (m === 'pretty' ? 'compact' : 'pretty'))}
                title={formatMode === 'pretty' ? 'Switch to Compact JSON' : 'Switch to Formatted JSON'}
              >
                {formatMode === 'pretty' ? 'Compact' : 'Prettify'}
              </button>
            )}

            <button
              type="button"
              className="btn secondary cyber-btn"
              style={{ height: 26, padding: '0 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={handleCopy}
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              className="btn icon-only"
              style={{ width: 26, height: 26 }}
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="value-viewer-body">
          <textarea
            readOnly
            spellCheck={false}
            className="value-viewer-text value-viewer-textarea"
            value={displayText}
          />
        </div>

        <div className="value-viewer-footer">
          <span>Read-only inspection · Press <kbd className="hint-kbd">ESC</kbd> to close</span>
          <button type="button" className="btn cyber-btn" style={{ height: 26, padding: '0 12px' }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}


