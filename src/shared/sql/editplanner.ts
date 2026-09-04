// Safe-edit planning.
//
// A SELECT result is directly editable only when the application can identify
// the underlying table and its full primary key. This module implements a
// deliberately conservative heuristic parser:
//
//   * single FROM source, no JOIN/UNION/GROUP BY/HAVING/DISTINCT/WINDOW
//   * no nested SELECT (subqueries/CTEs)
//   * no aggregates
//   * every result column must resolve to a table column (by exact name match)
//   * ALL primary-key columns must be present in the result
//
// When a plan can't be established safely the result is read-only and the UI
// explains why. We never guess a target row.

import type { SafeEditPlan, EditPlanColumn, QueryColumn } from '@shared/models/explorer'

export interface TableColumnInfo {
  name: string
  dataType: string
  pk: boolean
  nullable: boolean
}

export interface EditPlanInput {
  sql: string
  isSelectish: boolean
  resultColumns: QueryColumn[]
  /**
   * Metadata lookup. `schema === null` means the SQL referenced an unqualified
   * table name (e.g. `FROM users`) — the implementation must resolve it
   * against the session's search_path and return the schema it actually
   * found. Returning null means "cannot identify the table" and the planner
   * fails closed (result stays read-only).
   */
  lookup: (
    schema: string | null,
    table: string
  ) => Promise<{ schema: string; columns: TableColumnInfo[] } | null>
}

const AGGREGATE_FUNCS: string[] = [
  'COUNT','SUM','AVG','MIN','MAX','ARRAY_AGG','STRING_AGG','EVERY','BOOL_AND','BOOL_OR',
  'CORR','COVAR_POP','COVAR_SAMP','STDDEV','STDDEV_POP','STDDEV_SAMP','VARIANCE','VAR_POP','VAR_SAMP',
  'JSON_AGG','JSONB_AGG','JSON_OBJECT_AGG','JSONB_OBJECT_AGG','MODE','PERCENTILE_CONT','PERCENTILE_DISC'
]
/** Heuristic: fails closed (returns "not clean") — conservative direction. */
function isCleanSingleSourceSelect(
  sql: string
): { clean: boolean; schema?: string; table?: string; reason?: string } {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  const upper = stripped.toUpperCase()

  const agg = AGGREGATE_FUNCS.find((f) => new RegExp(`\\b${f}\\s*\\(`, 'i').test(upper))
  if (agg) {
    return { clean: false, reason: `Aggregate "${agg}" prevents safe editing.` }
  }

  if (
    /\b(JOIN|UNION|INTERSECT|EXCEPT|GROUP\s+BY|HAVING|DISTINCT|WINDOW|CUBE|ROLLUP|FETCH\s+FIRST)/.test(
      upper
    )
  ) {
    return { clean: false, reason: 'Joins, unions, grouping, DISTINCT or window functions prevent safe editing.' }
  }
  if (/^\s*WITH\b/i.test(stripped)) {
    return { clean: false, reason: 'CTEs (WITH …) prevent safe editing.' }
  }
  const selectCount = (upper.match(/\bSELECT\b/g) ?? []).length
  if (selectCount > 1) {
    return { clean: false, reason: 'Subqueries prevent safe editing.' }
  }
  const fromIdx = upper.indexOf(' FROM ')
  if (fromIdx < 0) {
    return { clean: false, reason: 'No FROM clause found.' }
  }

  const afterFrom = stripped.slice(fromIdx + 6)
  const tablePart = afterFrom.replace(/^\s*(ONLY\s+)?/, '').trim()

  const m = tablePart.match(/^("[^"]+"|[A-Za-z_][\w$]*)(\.("[^"]+"|[A-Za-z_][\w$]*))?/)
  if (!m) {
    return { clean: false, reason: 'Could not resolve the source table.' }
  }
  const first = unquote(m[1])
  const second = m[3] ? unquote(m[3]) : undefined
  const schema = second ? first : undefined
  const table = second ?? first

  const rest = tablePart.slice(m[0].length)
  if (/\b(FROM|JOIN)\b/i.test(rest)) {
    return { clean: false, reason: 'Multiple sources detected.' }
  }

  return { clean: true, schema, table }
}

function unquote(ident: string): string {
  if (ident.startsWith('"') && ident.endsWith('"')) {
    return ident.slice(1, -1).replace(/""/g, '"')
  }
  return ident
}

export async function planSafeEdit(input: EditPlanInput): Promise<SafeEditPlan> {
  const base: SafeEditPlan = { editable: false, pkColumns: [], columns: [] }

  if (!input.isSelectish || input.sql.trim().length === 0) {
    return { ...base, reason: 'Result is not from a plain SELECT.' }
  }

  const scan = isCleanSingleSourceSelect(input.sql)
  if (!scan.clean) {
    return { ...base, reason: scan.reason ?? 'Result does not map to a single source table.' }
  }
  if (!scan.table) {
    return { ...base, reason: 'Source table could not be qualified.' }
  }

  const lookupResult = await input.lookup(scan.schema ?? null, scan.table)
  if (!lookupResult) {
    return {
      ...base,
      reason: `Could not resolve table "${scan.table}"${scan.schema ? ` in schema "${scan.schema}"` : ' on the search_path'} — metadata lookup failed.`
    }
  }
  const schema = lookupResult.schema
  const columns = lookupResult.columns
  if (columns.length === 0) {
    return { ...base, reason: `Table "${schema}.${scan.table}" has no columns.` }
  }

  const pkColumns = columns.filter((c) => c.pk).map((c) => c.name)
  if (pkColumns.length === 0) {
    return {
      ...base,
      reason: `"${schema}.${scan.table}" has no primary key — direct editing is unsafe.`
    }
  }

  const colByName = new Map(columns.map((c) => [c.name, c]))
  const planColumns: EditPlanColumn[] = input.resultColumns.map((rc) => {
    const match = colByName.get(rc.name)
    return {
      key: rc.name,
      column: match?.name ?? rc.name,
      dataType: match?.dataType ?? rc.dataType,
      editable: match !== undefined && !pkColumns.includes(match.name)
    }
  })

  const missingPk = pkColumns.filter((pk) => !input.resultColumns.some((rc) => rc.name === pk))
  if (missingPk.length > 0) {
    return {
      ...base,
      reason: `Result is missing primary-key column(s): ${missingPk.join(', ')}.`
    }
  }
  if (!planColumns.some((c) => c.editable)) {
    return { ...base, reason: 'Result contains only primary-key columns; nothing to edit safely.' }
  }

  return {
    editable: true,
    schema: schema,
    table: scan.table,
    pkColumns,
    columns: planColumns
  }
}

/**
 * Generates a parameterized UPDATE for a single row's pending edits.
 * Values are always bound as $n parameters — never string-concatenated.
 */
export function buildParameterizedUpdate(
  schema: string,
  table: string,
  editsByColumn: Array<{ column: string; newValue: unknown }>,
  pkValues: Array<{ column: string; value: unknown }>
): { sql: string; params: unknown[] } | null {
  if (editsByColumn.length === 0 || pkValues.length === 0) return null

  const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`
  const sets = editsByColumn.map((e, i) => `${q(e.column)} = $${i + 1}`)
  const params: unknown[] = editsByColumn.map((e) => e.newValue)
  const wheres = pkValues.map((pv, i) => `${q(pv.column)} = $${sets.length + i + 1}`)
  params.push(...pkValues.map((pv) => pv.value))

  const sql = `UPDATE ${q(schema)}.${q(table)} SET ${sets.join(', ')} WHERE ${wheres.join(' AND ')}`
  return { sql, params }
}

/** Compact human-readable diff line for the pending-changes UI. */
export function describeDiff(oldValue: unknown, newValue: unknown): string {
  const fmt = (v: unknown): string =>
    v === null || v === undefined ? 'NULL' : JSON.stringify(v)
  return `${fmt(oldValue)} → ${fmt(newValue)}`
}