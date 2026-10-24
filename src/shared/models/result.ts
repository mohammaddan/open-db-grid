// Query execution + result models. A SELECT result is paged: the first page
// comes back with the initial execute, subsequent pages via fetchPage.

export type ResultKind = 'SELECT' | 'DML' | 'DDL' | 'UTILITY' | 'EXPLAIN' | 'UNKNOWN'

export interface QueryColumn {
  name: string
  /** Postgres format_type() display (e.g. `character varying(255)`). */
  dataType: string
  nullable: boolean
  /** pg_attribute.atttypid — allows renderer type-aware editing. */
  typeOid?: number
}

export interface ResultRow {
  /** stable id used by the grid and the pending-edit model */
  __rowId: number
  [key: string]: unknown
}

export interface QueryPage {
  columns: QueryColumn[]
  rows: ResultRow[]
  hasMore: boolean
  /** total rows fetched so far */
  fetched: number
  /** total number of rows matching the query, if determined */
  totalRows?: number
}

export interface ExecuteRequest {
  connectionId: string
  sql: string
  /** cap for the initial page size */
  pageSize?: number
  /**
   * Caller-chosen id for this execution attempt, so a hung FIRST page can be
   * cancelled (the driver reuses it as the cursor session / run key).
   */
  sessionKey?: string
}

export interface ExplainRequest {
  connectionId: string
  sql: string
  analyze: boolean
}

export interface ExecuteResult {
  kind: ResultKind
  sql: string
  durationMs: number
  /** SELECT results */
  sessionId?: string
  columns?: QueryColumn[]
  page?: QueryPage
  /** DML */
  rowsAffected?: number
  /** Total number of rows matching the query, if determined */
  totalRows?: number
  /** DDL / utility informational result */
  message?: string
  /** returned by script execution: results of each statement */
  statements?: ScriptStatementResult
  warning?: string
}

export interface ScriptStatementResult {
  index: number
  sql: string
  durationMs: number
  rowsAffected?: number
  hasResult: boolean
  error?: QueryErrorInfo
}

/** Rows affected + duration, returned for DML */
export interface DmlResult {
  rowsAffected: number
  durationMs: number
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface QueryErrorInfo {
  /** human-readable primary message */
  message: string
  severity?: string
  /** PostgreSQL SQLSTATE, e.g. 42501, 23505, 57014 */
  sqlState?: string
  /** 1-based character position in the statement, if PG provided one */
  position?: number
  detail?: string
  hint?: string
  context?: string
  /** node-postgres fallback errors (timeouts etc.) carry a code */
  code?: string
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export interface CancelResult {
  canceled: boolean
  message?: string
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'csv' | 'tsv' | 'json'

export interface ExportRequest {
  connectionId: string
  sessionId: string
  format: ExportFormat
  filePath: string
  /** null = all rows decoded from streamed pages */
  options?: {
    includeHeader?: boolean
  }
}

export interface ExportResult {
  rows: number
  bytes: number
  durationMs: number
}

export interface ExplainResult {
  rows: string[]
  durationMs: number
}