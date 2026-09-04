// Database explorer node model. The explorer is a lazy tree addressed by a
// stable node key; the main process resolves the key against PostgreSQL
// catalogs, so the renderer never issues metadata SQL itself.

import type { QueryErrorInfo } from './result'

/** Result column descriptors come from the result model. */
export type { QueryColumn } from './result'

export type ExplorerNodeKind =
  | 'connection'
  | 'databases'
  | 'database'
  | 'schemas'
  | 'schema'
  | 'tables'
  | 'table'
  | 'views'
  | 'view'
  | 'matviews'
  | 'matview'
  | 'functions'
  | 'function'
  | 'procedures'
  | 'procedure'
  | 'sequences'
  | 'sequence'
  | 'types'
  | 'type'
  | 'extensions'
  | 'extension'
  | 'columns'
  | 'column'
  | 'indexes'
  | 'index'
  | 'foreign-keys'
  | 'foreign-key'
  | 'constraints'
  | 'constraint'
  | 'triggers'
  | 'trigger'
  | 'catalog-or-metadata'

export interface ExplorerNode {
  /** addressable key: `schema|table` etc. */
  key: string
  name: string
  kind: ExplorerNodeKind
  hasChildren: boolean
  /** pagination hint for large lists (tables/views/functions/…) */
  count?: number
  comment?: string
  meta?: Record<string, unknown>
}

export interface ExplorerChildrenRequest {
  connectionId: string
  parentKey: string | null
  forceRefresh?: boolean
}

export interface BrowseTarget {
  schema: string
  table: string
}

export interface TableIdentity {
  schema: string
  table: string
  kind: 'table' | 'view' | 'matview'
}

// ---------------------------------------------------------------------------
// Safe-edit planning
// ---------------------------------------------------------------------------

export interface EditPlanColumn {
  /** result column name */
  key: string
  /** underlying table column name (after alias resolution) */
  column: string
  dataType: string
  editable: boolean
}

export interface SafeEditPlan {
  editable: boolean
  /** when not editable, a human explanation shown in the UI */
  reason?: string
  schema?: string
  table?: string
  /** primary-key columns; edits are keyed on their values */
  pkColumns: string[]
  columns: EditPlanColumn[]
}

export interface PendingEdit {
  rowKey: number
  /** result column key */
  column: string
  oldValue: unknown
  newValue: unknown
  /** PK column values captured from the row at edit time (for the WHERE clause) */
  pkValues: Array<{ column: string; value: unknown }>
}

export interface SaveEditsResult {
  updated: number
  /** rows skipped because the pk row no longer exists */
  skipped: number
  /** parameterized SQL executed (for display/debug); excludes secret values */
  executedStatements: string[]
  firstError?: QueryErrorInfo
}

/**
 * Addressable explorer context. The renderer sends these; drivers translate
 * them into catalog queries so the UI never embeds engine-specific SQL.
 */
export type ExploreSource =
  | { kind: 'roots' }
  | { kind: 'databases' }
  | { kind: 'schemas' }
  | { kind: 'schema-sections'; schema: string }
  | { kind: 'table-sections'; schema: string; table: string }
  | { kind: 'schema-tables'; schema: string }
  | { kind: 'schema-views'; schema: string }
  | { kind: 'schema-matviews'; schema: string }
  | { kind: 'schema-functions'; schema: string }
  | { kind: 'schema-procedures'; schema: string }
  | { kind: 'schema-sequences'; schema: string }
  | { kind: 'schema-types'; schema: string }
  | { kind: 'schema-extensions'; schema: string }
  | { kind: 'table-columns'; schema: string; table: string }
  | { kind: 'table-indexes'; schema: string; table: string }
  | { kind: 'table-fks'; schema: string; table: string }
  | { kind: 'table-constraints'; schema: string; table: string }
  | { kind: 'table-triggers'; schema: string; table: string }
  | { kind: 'view-columns'; schema: string; table: string }
  | { kind: 'matview-columns'; schema: string; table: string }

export interface TableColumnMeta {
  name: string
  dataType: string
  nullable: boolean
  isPk: boolean
  position: number
  defaultValue?: string | null
  comment?: string | null
}