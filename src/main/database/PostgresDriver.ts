// PostgreSQL driver implementation.
//
// Paging results use a dedicated client per cursor session:
//   BEGIN READ ONLY; DECLARE cur CURSOR FOR <sql>; FETCH FORWARD N
// so a 1M-row query never materializes in memory. Cursor sessions are a
// bounded resource: they are reclaimed after an idle timeout and whenever the
// user transaction they depend on ends, because an open cursor pins a
// snapshot (xmin horizon) and would block VACUUM on the server.
//
// Cancellation (pg_cancel_backend on a dedicated control client) and all other
// PostgreSQL specifics stay inside this module — services only see the
// DriverSession interface.
//
// Read-only mode is enforced by the ENGINE (`default_transaction_read_only=on`
// startup option AND a SET on every pooled client). The shared SQL classifier
// is a UX aid only (friendly messages, confirm dialogs) — never a security
// boundary.

import { Pool, Client, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import type { DbConnection } from '@shared/models/connection'
import type {
  CancelResult,
  ExecuteResult,
  ExplainResult,
  ExportRequest,
  ExportResult,
  QueryColumn,
  QueryErrorInfo,
  QueryPage
} from '@shared/models/result'
import type {
  BrowseTarget,
  ExploreSource,
  ExplorerNode,
  PendingEdit,
  SafeEditPlan,
  SaveEditsResult,
  TableColumnMeta
} from '@shared/models/explorer'
import type { TransactionStatus } from '@shared/models/transactions'
import { DatabaseError, toQueryErrorInfo } from './errors'
import { createSshTunnel } from './ssh'
import { classifyStatement } from '@shared/sql/classifier'
import { planSafeEdit, buildParameterizedUpdate } from '@shared/sql/editplanner'
import { explorePostgres, columnsForTable, resolveVisibleSchema } from './metadata'
import { streamExport } from './postgresExport'
import { buildPgSsl, mapResultKind } from './postgresHelpers'
import type { DriverSession } from './DatabaseDriver'

interface CursorSession {
  client: PoolClient
  cursorName: string
  sql: string
  columns: QueryColumn[]
  openedAt: number
  lastAccessAt: number
  closed: boolean
  fetched: number
  /** true when the cursor lives on the shared user-transaction client */
  onTxnClient: boolean
  totalRows?: number
}

const DEFAULT_PAGE_SIZE = 500
const MAX_PAGE_SIZE = 5000
const METADATA_TTL_MS = 60_000
/** a cursor unused for this long is closed (it pins a server snapshot) */
const CURSOR_IDLE_TTL_MS = 120_000
const CURSOR_SWEEP_INTERVAL_MS = 30_000

export class PostgresDriverSession implements DriverSession {
  readonly engine = 'postgresql' as const
  readonly connectionId: string
  readonly readOnly: boolean
  readonly production: boolean

  private pool: Pool
  private tunnel?: { host: string; port: number; close(): Promise<void> }
  private disposed = false
  private cursors = new Map<string, CursorSession>()
  /** retains the SQL of exhausted/closed sessions so export can reopen a cursor */
  private closedSessions = new Map<string, { sql: string; columns: QueryColumn[] }>()
  private inFlight = new Map<string, { client: PoolClient; pid: number }>()
  private controlClient: Client | null = null
  private txnClient: PoolClient | null = null
  private txnStartedAt: number | null = null
  private metadataCache = new Map<string, { nodes: ExplorerNode[]; ts: number }>()
  private sweeper?: NodeJS.Timeout

  constructor(
    private readonly conn: DbConnection,
    private readonly password: string | null,
    private readonly tunnelHandle?: Awaited<ReturnType<typeof createSshTunnel>>
  ) {
    this.connectionId = conn.id
    this.readOnly = conn.accessMode === 'read-only'
    this.production = Boolean(conn.production)
    this.tunnel = tunnelHandle

    const host = tunnelHandle ? tunnelHandle.host : conn.config.host
    const port = tunnelHandle ? tunnelHandle.port : conn.config.port
    const ssl = buildPgSsl(conn.config.ssl)
    const appName = conn.config.applicationName || 'OpenDBGrid'
    const options: string[] = [`-c application_name=${appName}`]
    if (this.readOnly) options.push('-c default_transaction_read_only=on')

    this.pool = new Pool({
      host,
      port,
      database: conn.config.database,
      user: conn.config.username,
      password: password ?? undefined,
      ssl: ssl !== false ? ssl : undefined,
      connectionTimeoutMillis: conn.config.connectTimeoutMs,
      max: conn.config.poolSize,
      idleTimeoutMillis: 60_000,
      options: options.join(' ')
    })

    // Second, independent engine-level guarantee for read-only connections:
    // every pooled client runs SET default_transaction_read_only = on when it
    // connects (the startup option above already covers new sessions).
    if (this.readOnly) {
      this.pool.on('connect', (client) => {
        void client.query('SET default_transaction_read_only = on').catch(() => undefined)
      })
    }

    // Reclaim abandoned cursor sessions: an open cursor holds a transaction
    // snapshot and would pin the xmin horizon, blocking VACUUM server-side.
    this.sweeper = setInterval(() => {
      void this.sweepExpiredSessions(CURSOR_IDLE_TTL_MS).catch(() => undefined)
    }, CURSOR_SWEEP_INTERVAL_MS)
  }

  async probe(): Promise<{ ok: boolean; serverVersion?: string; latencyMs?: number; error?: QueryErrorInfo }> {
    const start = Date.now()
    try {
      const res = await this.pool.query<{ version: string }>('SELECT version() AS version')
      return { ok: true, serverVersion: res.rows[0]?.version, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, error: toQueryErrorInfo(err), latencyMs: Date.now() - start }
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  async execute(sql: string, opts?: { pageSize?: number; sessionKey?: string }): Promise<ExecuteResult> {
    const pageSize = Math.min(opts?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const startedAt = Date.now()
    const classified = classifyStatement(sql)

    if (this.readOnly && classified.isModifying) {
      throw {
        message: `Execution blocked: "${classified.kind}" modifies data/schema and this connection is read-only.`,
        sqlState: '25006',
        code: '25006'
      }
    }

    if (classified.kind === 'SELECT' && classified.producesResult) {
      const sessionId = opts?.sessionKey ?? randomUUID()
      const page = await this.openCursor(sessionId, sql, pageSize, startedAt)
      return {
        kind: 'SELECT',
        sql,
        durationMs: Date.now() - startedAt,
        sessionId,
        columns: page.columns,
        page,
        totalRows: page.totalRows,
        rowsAffected: 0
      }
    }

    return this.runInline(sql, classified.kind, startedAt, opts?.sessionKey)
  }

  private async runInline(
    sql: string,
    kind: string,
    startedAt: number,
    sessionKey?: string
  ): Promise<ExecuteResult> {
    const runKey = sessionKey ?? randomUUID()
    const client = this.txnClient ?? (await this.pool.connect())
    const pid = await this.backendPid(client)
    this.inFlight.set(runKey, { client, pid })
    try {
      const res = await client.query(sql)
      const base: ExecuteResult = {
        kind: mapResultKind(kind),
        sql,
        durationMs: Date.now() - startedAt,
        rowsAffected: res.rowCount !== null ? res.rowCount : undefined,
        message: res.command ? `${res.command} complete` : undefined
      }
      // Utility commands that return a result set (SHOW, SET … RETURNING,
      // VALUES, TABLE, INFORMATION, EXPLAIN) surface their rows inline.
      if (res.fields.length > 0) {
        const columns = this.columnsFromRes(res)
        base.columns = columns
        base.page = {
          columns,
          rows: res.rows.map((r, i) => ({
            __rowId: i + 1,
            ...(r as Record<string, unknown>)
          })),
          hasMore: false,
          fetched: res.rows.length,
          totalRows: res.rows.length
        }
        base.totalRows = res.rows.length
      }
      return base
    } catch (err) {
      throw toQueryErrorInfo(err)
    } finally {
      this.inFlight.delete(runKey)
      if (!this.txnClient) client.release()
    }
  }

  private async fetchRows(
    client: PoolClient,
    cursorName: string,
    n: number
  ): Promise<{ rows: unknown[]; fields: import('pg').FieldDef[] }> {
    const res = await client.query(`FETCH FORWARD ${n} FROM "${cursorName}"`)
    return { rows: res.rows, fields: res.fields }
  }

  private columnsFromRes(res: { fields: import('pg').FieldDef[] }): QueryColumn[] {
    return res.fields.map((f) => ({
      name: f.name,
      dataType: `oid:${f.dataTypeID}`,
      nullable: true,
      typeOid: f.dataTypeID
    }))
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.cursors.get(sessionId)
    if (!session || session.closed) return
    this.cursors.delete(sessionId)
    session.closed = true
    // retain SQL+columns so the result can still be exported after close
    this.closedSessions.set(sessionId, { sql: session.sql, columns: session.columns })
    // close only OUR cursor — CLOSE ALL would also kill cursors opened by
    // someone else on the shared transaction client
    await session.client.query(`CLOSE "${session.cursorName}"`).catch(() => undefined)
    if (!session.onTxnClient) {
      // dedicated client: release the snapshot transaction and the client
      try {
        await session.client.query('ROLLBACK')
      } catch {
        /* ignore */
      }
      session.client.release()
    }
    // txn-bound cursors share the user transaction's client; the client stays
    // under transaction control (commit/rollback will release it)
  }

  /** Closes sessions idle longer than maxIdleMs. Returns closed session ids. */
  async sweepExpiredSessions(maxIdleMs: number): Promise<string[]> {
    const now = Date.now()
    const expired: string[] = []
    for (const [id, s] of [...this.cursors]) {
      if (s.closed || now - s.lastAccessAt > maxIdleMs) {
        expired.push(id)
        await this.closeSession(id).catch(() => undefined)
      }
    }
    return expired
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  async cancel(sessionId: string): Promise<CancelResult> {
    const entry = this.inFlight.get(sessionId)
    if (!entry) return { canceled: false, message: 'No running query for this session.' }
    try {
      const control = await this.ensureControl()
      const res = await control.query<{ pg_cancel_backend: boolean }>(
        'SELECT pg_cancel_backend($1) AS pg_cancel_backend',
        [entry.pid]
      )
      const canceled = res.rows[0]?.pg_cancel_backend ?? false
      return {
        canceled,
        message: canceled
          ? 'Cancellation request sent to the server.'
          : 'The query finished before cancellation could be requested.'
      }
    } catch (err) {
      return { canceled: false, message: `Could not cancel: ${toQueryErrorInfo(err).message}` }
    }
  }

  private async ensureControl(): Promise<Client> {
    if (!this.controlClient) {
      this.controlClient = new Client({
        host: this.pool.options.host,
        port: this.pool.options.port,
        database: this.pool.options.database,
        user: this.pool.options.user,
        password: this.pool.options.password,
        ssl: this.pool.options.ssl,
        connectionTimeoutMillis: 15_000
      })
      await this.controlClient.connect()
    }
    return this.controlClient
  }

  private async backendPid(client: PoolClient | Client): Promise<number> {
    const res = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    return res.rows[0]?.pid ?? 0
  }

  private async safeReleaseAfterOpen(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    client.release()
  }

  // -------------------------------------------------------------------------
  // EXPLAIN / EXPORT
  // -------------------------------------------------------------------------

  async explain(sql: string, analyze: boolean): Promise<ExplainResult> {
    const startedAt = Date.now()
    const body = analyze ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)' : 'EXPLAIN (FORMAT TEXT)'
    const client = this.txnClient ?? (await this.pool.connect())
    const pid = await this.backendPid(client)
    const key = randomUUID()
    this.inFlight.set(key, { client, pid })
    try {
      const res = await client.query<{ 'QUERY PLAN': string }>(`${body}\n${sql}`)
      return { rows: res.rows.map((r) => r['QUERY PLAN']), durationMs: Date.now() - startedAt }
    } catch (err) {
      throw toQueryErrorInfo(err)
    } finally {
      this.inFlight.delete(key)
      if (!this.txnClient) client.release()
    }
  }

  async exportResult(req: ExportRequest): Promise<ExportResult> {
    const session = this.cursors.get(req.sessionId)
    const closed = this.closedSessions.get(req.sessionId)
    const sql = session?.sql ?? closed?.sql
    const columns = session?.columns ?? closed?.columns
    if (!sql || !columns) {
      throw new DatabaseError({
        message: 'Result set expired — run the query again before exporting.',
        code: 'EFORGE_SESSION_GONE'
      })
    }
    // Export always streams the FULL result from a fresh snapshot cursor —
    // the live cursor may already be partially consumed by interactive paging
    // (or auto-closed when the result fit the first page). Reopening from the
    // stored SQL guarantees the exported file contains every row.
    const client = await this.pool.connect()
    const cursorName = `exp_${req.sessionId.replace(/-/g, '')}`
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`DECLARE "${cursorName}" NO SCROLL CURSOR FOR ${sql}`)
      return await streamExport(
        {
          columns,
          fetchNextPage: async (maxRows) => {
            const res = await client.query(`FETCH FORWARD ${maxRows} FROM "${cursorName}"`)
            const rows = res.rows as unknown as Record<string, unknown>[]
            return { rows, hasMore: rows.length === maxRows }
          }
        },
        req
      )
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
  }
// -------------------------------------------------------------------------
  // Cursor sessions (paged SELECT results)
  // -------------------------------------------------------------------------

  private async openCursor(
    sessionId: string,
    sql: string,
    pageSize: number,
    startedAt: number
  ): Promise<QueryPage> {
    const client = this.txnClient ?? (await this.pool.connect())
    const cursorName = `cur_${sessionId.replace(/-/g, '')}`
    const pid = await this.backendPid(client)
    this.inFlight.set(sessionId, { client, pid })
    try {
      if (!this.txnClient) await client.query('BEGIN READ ONLY')
      await client.query(`DECLARE "${cursorName}" NO SCROLL CURSOR FOR ${sql}`)
      const fetched = await this.fetchRows(client, cursorName, pageSize)
      const columns = this.columnsFromRes(fetched)

      const session: CursorSession = {
        client,
        cursorName,
        sql,
        columns,
        openedAt: Date.now(),
        lastAccessAt: Date.now(),
        closed: false,
        fetched: 0,
        onTxnClient: this.txnClient !== null
      }
      this.cursors.set(sessionId, session)

      const rows = fetched.rows.map((r, i) => ({
        __rowId: i + 1,
        ...(r as Record<string, unknown>)
      }))
      session.fetched = rows.length
      const hasMore = rows.length === pageSize
      let totalRows: number | undefined
      if (!hasMore) {
        totalRows = rows.length
      } else {
        totalRows = await this.countQueryRows(sql)
      }
      session.totalRows = totalRows

      if (!hasMore) {
        this.closedSessions.set(sessionId, { sql, columns })
        void this.closeSession(sessionId)
      }
      return { columns, rows, hasMore, fetched: rows.length, totalRows }
    } catch (err) {
      await this.safeReleaseAfterOpen(client)
      throw toQueryErrorInfo(err)
    } finally {
      this.inFlight.delete(sessionId)
    }
  }

  async fetchPage(sessionId: string, pageSize?: number): Promise<QueryPage> {
    const session = this.cursors.get(sessionId)
    if (!session || session.closed) {
      throw new DatabaseError({
        message: 'Result set expired — run the query again to continue browsing.',
        code: 'EFORGE_SESSION_GONE'
      })
    }
    const n = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const pid = await this.backendPid(session.client)
    this.inFlight.set(sessionId, { client: session.client, pid })
    try {
      const res = await this.fetchRows(session.client, session.cursorName, n)
      const rows = res.rows.map((r, i) => ({
        __rowId: session.fetched + i + 1,
        ...(r as Record<string, unknown>)
      }))
      session.fetched += rows.length
      session.lastAccessAt = Date.now()
      const hasMore = rows.length === n
      if (!hasMore) {
        this.closedSessions.set(sessionId, { sql: session.sql, columns: session.columns })
        void this.closeSession(sessionId)
      }
      return { columns: session.columns, rows, hasMore, fetched: session.fetched, totalRows: session.totalRows }
    } catch (err) {
      throw toQueryErrorInfo(err)
    } finally {
      this.inFlight.delete(sessionId)
    }
  }

  private async countQueryRows(sql: string): Promise<number | undefined> {
    try {
      const cleanSql = sql.trim().replace(/;+\s*$/, '')
      const countSql = `SELECT count(*)::text AS total FROM (${cleanSql}) AS _total_count_sub`
      const client = await this.pool.connect()
      try {
        await client.query('SET statement_timeout = 3000')
        const res = await client.query(countSql)
        const total = Number(res.rows[0]?.total)
        return Number.isFinite(total) ? total : undefined
      } finally {
        await client.query('SET statement_timeout = 0').catch(() => {})
        client.release()
      }
    } catch {
      return undefined
    }
  }
// -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  async txnStatus(): Promise<TransactionStatus> {
    return {
      connectionId: this.connectionId,
      state: this.txnClient ? 'open' : 'none',
      startedAt: this.txnStartedAt ?? undefined
    }
  }

  async begin(): Promise<void> {
    if (this.txnClient) throw new DatabaseError({ message: 'A transaction is already open.' })
    const client = await this.pool.connect()
    try {
      // Read-only connections get an explicitly read-only transaction: useful
      // for stable-snapshot reads; the engine still rejects every write.
      await client.query(this.readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
      this.txnClient = client
      this.txnStartedAt = Date.now()
    } catch (err) {
      client.release()
      throw toQueryErrorInfo(err)
    }
  }

  /** Closes cursors bound to the user transaction before it ends. */
  private async closeTxnBoundCursors(): Promise<void> {
    for (const id of [...this.cursors.keys()]) {
      const s = this.cursors.get(id)
      if (s?.onTxnClient) await this.closeSession(id).catch(() => undefined)
    }
  }

  async commit(): Promise<void> {
    if (!this.txnClient) throw new DatabaseError({ message: 'No transaction is open.' })
    const client = this.txnClient
    this.txnClient = null
    this.txnStartedAt = null
    await this.closeTxnBoundCursors()
    try {
      await client.query('COMMIT')
      client.release()
    } catch (err) {
      client.release()
      throw toQueryErrorInfo(err)
    }
  }

  async rollback(): Promise<void> {
    if (!this.txnClient) throw new DatabaseError({ message: 'No transaction is open.' })
    const client = this.txnClient
    this.txnClient = null
    this.txnStartedAt = null
    await this.closeTxnBoundCursors()
    try {
      await client.query('ROLLBACK')
      client.release()
    } catch (err) {
      client.release()
      throw toQueryErrorInfo(err)
    }
  }

  // -------------------------------------------------------------------------
  // Safe result editing — parameterized UPDATEs, PK-verified
  // -------------------------------------------------------------------------

  async saveEdits(plan: SafeEditPlan, edits: PendingEdit[]): Promise<SaveEditsResult> {
    if (this.readOnly) {
      throw {
        message: 'This connection is read-only — data changes are not allowed.',
        sqlState: '25006',
        code: '25006'
      }
    }
    if (!plan.editable || !plan.schema || !plan.table) {
      throw new DatabaseError({ message: 'Result is not safely editable: ' + (plan.reason ?? 'no plan') })
    }

    const usedPk = new Set(plan.pkColumns)
    const groups = new Map<number, PendingEdit[]>()
    for (const edit of edits) {
      const arr = groups.get(edit.rowKey) ?? []
      arr.push(edit)
      groups.set(edit.rowKey, arr)
    }

    const executedStatements: string[] = []
    let updated = 0
    let skipped = 0
    let firstError: QueryErrorInfo | undefined

    const client = this.txnClient ?? (await this.pool.connect())
    try {
      for (const [rowKey, rowEdits] of groups) {
        const pkValues = rowEdits[0].pkValues.filter(
          (pv) => usedPk.has(pv.column) && pv.value !== null && pv.value !== undefined
        )
        if (pkValues.length < usedPk.size) {
          skipped++
          continue
        }
        const setCols = rowEdits.map((e) => ({ column: planResolveColumn(plan, e.column), newValue: e.newValue }))
        const stmt = buildParameterizedUpdate(plan.schema, plan.table, setCols, pkValues)
        if (!stmt) {
          skipped++
          continue
        }
        try {
          const res = await client.query(stmt.sql, stmt.params)
          if (res.rowCount === 1) updated++
          else skipped++
          executedStatements.push(stmt.sql)
        } catch (err) {
          firstError = toQueryErrorInfo(err)
          executedStatements.push(stmt.sql)
          break
        }
        void rowKey
      }
      if (!this.txnClient) await client.query('COMMIT')
    } catch (err) {
      firstError = toQueryErrorInfo(err)
      if (!this.txnClient) await client.query('ROLLBACK').catch(() => undefined)
    } finally {
      if (!this.txnClient) client.release()
    }

    return { updated, skipped, executedStatements, firstError }
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  async explore(source: ExploreSource, forceRefresh = false): Promise<ExplorerNode[]> {
    const key = JSON.stringify(source)
    const cached = this.metadataCache.get(key)
    if (!forceRefresh && cached && Date.now() - cached.ts < METADATA_TTL_MS) {
      return cached.nodes
    }
    const client = this.txnClient ?? (await this.pool.connect())
    try {
      const nodes = await explorePostgres(client, source)
      this.metadataCache.set(key, { nodes, ts: Date.now() })
      return nodes
    } catch (err) {
      throw toQueryErrorInfo(err)
    } finally {
      if (!this.txnClient) client.release()
    }
  }
async tableColumns(schema: string, table: string): Promise<TableColumnMeta[]> {
    const client = this.txnClient ?? (await this.pool.connect())
    try {
      return await columnsForTable(client, schema, table, true)
    } catch (err) {
      throw toQueryErrorInfo(err)
    } finally {
      if (!this.txnClient) client.release()
    }
  }

  async planForSelect(sql: string, resultColumnNames: string[]): Promise<SafeEditPlan> {
    const classified = classifyStatement(sql)
    const resultColumns = resultColumnNames.map((name) => ({
      name,
      dataType: 'text',
      nullable: true
    }))
    return planSafeEdit({
      sql,
      isSelectish: classified.kind === 'SELECT',
      resultColumns,
      lookup: async (schema, table) => {
        const client = this.txnClient ?? (await this.pool.connect())
        const owned = !this.txnClient
        try {
          let resolved = schema
          if (!resolved) {
            // Unqualified table name: resolve against the session search_path
            // so `SELECT id FROM users` is editable like a qualified query.
            resolved = await resolveVisibleSchema(client, table)
            if (!resolved) return null
          }
          const cols = await columnsForTable(client, resolved, table, true)
          return {
            schema: resolved,
            columns: cols.map((c) => ({
              name: c.name,
              dataType: c.dataType,
              pk: c.isPk,
              nullable: c.nullable
            }))
          }
        } catch {
          return null
        } finally {
          if (owned) client.release()
        }
      }
    })
  }

  async browse(target: BrowseTarget, pageSize?: number): Promise<ExecuteResult> {
    const schema = target.schema.replace(/"/g, '""')
    const table = target.table.replace(/"/g, '""')
    const sql = `SELECT * FROM "${schema}"."${table}"`
    return this.execute(sql, { pageSize })
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = undefined
    }
    for (const id of [...this.cursors.keys()]) {
      await this.closeSession(id).catch(() => undefined)
    }
    this.closedSessions.clear()
    if (this.txnClient) {
      try {
        await this.txnClient.query('ROLLBACK')
      } catch {
        /* ignore */
      }
      this.txnClient.release()
      this.txnClient = null
    }
    if (this.controlClient) {
      try {
        await this.controlClient.end()
      } catch {
        /* ignore */
      }
      this.controlClient = null
    }
    await this.pool.end().catch(() => undefined)
    if (this.tunnel) await this.tunnel.close().catch(() => undefined)
  }
}

function planResolveColumn(plan: SafeEditPlan, key: string): string {
  const col = plan.columns.find((c) => c.key === key)
  return col?.column ?? key
}