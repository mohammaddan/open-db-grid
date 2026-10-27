// DatabaseDriver abstraction.
//
// UI and application services depend ONLY on these interfaces. A new engine
// (MySQL, SQLite, MSSQL, …) implements `DriverFactory` + `DriverSession`
// without touching the renderer or the query/explorer services.
//
// Driver sessions own a real connection (pool) to the target database. Query
// cursor sessions are long-lived resource handles created by execute() that
// must be closed by the consumer (the query service handles TTL + cleanup).

import type { DbConnection, ConnectionTestResult, OpenConnectionInfo } from '@shared/models/connection'
import type {
  ExecuteResult,
  QueryPage,
  QueryErrorInfo,
  CancelResult,
  ExplainResult,
  ExportRequest,
  ExportResult
} from '@shared/models/result'
import type {
  ExplorerNode,
  ExploreSource,
  SafeEditPlan,
  PendingEdit,
  SaveEditsResult,
  TableColumnMeta,
  TableStructureInfo,
  TableSearchResult,
  BrowseTarget
} from '@shared/models/explorer'
import type { TransactionStatus } from '@shared/models/transactions'

export interface DriverConnectOptions {
  connection: DbConnection
  /** resolves the saved password for the connection (never returned to renderer) */
  secretProvider: () => Promise<string | null>
}

export interface DriverSession {
  readonly connectionId: string
  readonly engine: 'postgresql'
  readonly readOnly: boolean
  readonly production: boolean

  /** connectivity + server info probe */
  probe(): Promise<{ ok: boolean; serverVersion?: string; latencyMs?: number; error?: QueryErrorInfo }>

  /**
   * Executes a single statement.
   * - SELECT → opens a long-lived cursor session and returns the first page.
   * - DML/DDL/utility → runs on a pooled client and returns row counts.
   * Read-only connections reject modifying statements BEFORE execution and the
   * engine additionally enforces `default_transaction_read_only`.
   */
  execute(sql: string, opts?: { pageSize?: number; sessionKey?: string }): Promise<ExecuteResult>

  /** Fetches a page from an open cursor session. */
  fetchPage(sessionId: string, pageSize?: number, pageNumber?: number): Promise<QueryPage>

  /** Cancels an in-flight execution (driver-specific: pg_cancel_backend). */
  cancel(sessionId: string): Promise<CancelResult>

  /** Releases a cursor session and its dedicated connection. */
  closeSession(sessionId: string): Promise<void>

  /** Runs EXPLAIN (optionally ANALYZE) and returns the plan text lines. */
  explain(sql: string, analyze: boolean): Promise<ExplainResult>

  /** Streams a cursor session to a file (no full materialization). */
  exportResult(req: ExportRequest): Promise<ExportResult>

  /** Persists pending result-grid edits as parameterized UPDATEs. */
  saveEdits(plan: SafeEditPlan, edits: PendingEdit[]): Promise<SaveEditsResult>

  // metadata (lazy-loaded and cached inside the driver)
  explore(source: ExploreSource, forceRefresh?: boolean): Promise<ExplorerNode[]>
  tableColumns(schema: string, table: string): Promise<TableColumnMeta[]>
  tableStructure(schema: string, table: string): Promise<TableStructureInfo>
  searchTables(query: string): Promise<TableSearchResult[]>
  planForSelect(sql: string, resultColumnNames: string[]): Promise<SafeEditPlan>
  browse(target: BrowseTarget, pageSize?: number, pageNumber?: number): Promise<ExecuteResult>

  // transactions
  txnStatus(): Promise<TransactionStatus>
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>

  /** closes pool + tunnel; also invalidates all cursor sessions */
  dispose(): Promise<void>
}

export interface DriverFactory {
  readonly engine: 'postgresql'
  test(options: DriverConnectOptions): Promise<ConnectionTestResult>
  connect(options: DriverConnectOptions): Promise<DriverSession>
}

export interface DatabaseDriverRegistry {
  forEngine(engine: 'postgresql'): DriverFactory
}