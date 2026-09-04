// QueryService: orchestrates statement execution across the driver layer,
// tracks history, and exposes cursor paging / cancellation / export / edit-save.

import type {
  ExecuteRequest,
  ExecuteResult,
  ExplainRequest,
  ExplainResult,
  QueryPage,
  CancelResult,
  ExportRequest,
  ExportResult,
  QueryErrorInfo
} from '@shared/models/result'
import type { SafeEditPlan, PendingEdit, SaveEditsResult } from '@shared/models/explorer'
import { splitSqlStatements } from '@shared/sql/splitter'
import { classifyStatement } from '@shared/sql/classifier'
import { isReadOnlyBlocked } from '@shared/sql/classifier'
import { ConnectionService } from './ConnectionService'
import { HistoryService } from './HistoryService'
import { DatabaseError, toQueryErrorInfo } from '@main/database/errors'

export class QueryService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly history: HistoryService
  ) {}

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const session = await this.connections.ensureSession(req.connectionId)
    const blocked = isReadOnlyBlocked(req.sql)
    if (blocked.blocked && session.readOnly) {
      throw new DatabaseError({ message: blocked.reason ?? 'Execution blocked on read-only connection.', sqlState: '25006' })
    }
    try {
      const result = await session.execute(req.sql, { pageSize: req.pageSize, sessionKey: req.sessionKey })
      await this.record(req.connectionId, req.sql, result, undefined)
      return result
    } catch (err) {
      const info = toQueryErrorInfo(err)
      await this.record(req.connectionId, req.sql, undefined, info)
      throw new DatabaseError(info, info.code)
    }
  }

  /** Executes a script (multiple statements) sequentially, stopping on error. */
  async executeScript(req: ExecuteRequest): Promise<ExecuteResult> {
    const session = await this.connections.ensureSession(req.connectionId)
    const statements = splitSqlStatements(req.sql)
    if (statements.length === 0) {
      return { kind: 'UTILITY', sql: req.sql, durationMs: 0, message: 'Nothing to execute.' }
    }
    let lastResult: ExecuteResult | undefined
    const startedAt = Date.now()
    for (const stmt of statements) {
      const classified = classifyStatement(stmt.text)
      if (session.readOnly && classified.isModifying) {
        throw new DatabaseError({
          message: `Statement ${stmt.index + 1} blocked: "${classified.kind}" modifies data/schema and this connection is read-only.`,
          sqlState: '25006'
        })
      }
      try {
        const res = await session.execute(stmt.text, { pageSize: req.pageSize, sessionKey: req.sessionKey })
        // for SELECTs inside a script we keep only the first page (no session reuse)
        if (res.sessionId && res.kind === 'SELECT') {
          void session.closeSession(res.sessionId).catch(() => undefined)
          if (res.page) res.page = { ...res.page, hasMore: false }
          res.sessionId = undefined
        }
        lastResult = res
        await this.record(req.connectionId, stmt.text, res, undefined)
      } catch (err) {
        const info = toQueryErrorInfo(err)
        await this.record(req.connectionId, stmt.text, undefined, info)
        throw new DatabaseError(
          { ...info, message: `Statement ${stmt.index + 1} failed: ${info.message}` },
          info.code
        )
      }
    }
    return {
      ...(lastResult ?? { kind: 'UTILITY' as const, sql: req.sql, durationMs: 0 }),
      sql: req.sql,
      durationMs: Date.now() - startedAt
    }
  }

  async explain(req: ExplainRequest): Promise<ExplainResult> {
    const session = await this.connections.ensureSession(req.connectionId)
    const stmt = splitSqlStatements(req.sql)[0]
    if (!stmt) throw new DatabaseError({ message: 'Nothing to explain.' })
    try {
      return await session.explain(stmt.text, req.analyze)
    } catch (err) {
      throw new DatabaseError(toQueryErrorInfo(err))
    }
  }

  /** Fetches the next page of an open cursor. Requires the original session —
   * auto-opening a fresh one would lose the cursor, so fail with clear guidance. */
  async page(connectionId: string, sessionId: string, pageSize?: number): Promise<QueryPage> {
    try {
      const s = this.connections.getSession(connectionId)
      return await s.fetchPage(sessionId, pageSize)
    } catch (err) {
      if (err instanceof DatabaseError && err.info.code === 'EFORGE_NOT_CONNECTED') {
        throw new DatabaseError({
          message: 'The connection was closed — re-run the query to load more rows.',
          code: 'EFORGE_NOT_CONNECTED'
        })
      }
      throw err
    }
  }

  /** Cancels a running query. Nothing to cancel when the connection is closed. */
  async cancel(connectionId: string, sessionId: string): Promise<CancelResult> {
    if (!this.connections.isOpen(connectionId)) {
      return { canceled: false, message: 'Connection is not open — nothing to cancel.' }
    }
    const s = this.connections.getSession(connectionId)
    return s.cancel(sessionId)
  }

  async close(connectionId: string, sessionId: string): Promise<void> {
    if (!this.connections.isOpen(connectionId)) return
    const s = this.connections.getSession(connectionId)
    await s.closeSession(sessionId)
  }

  async exportResult(req: ExportRequest): Promise<ExportResult> {
    const s = await this.connections.ensureSession(req.connectionId)
    return s.exportResult(req)
  }

  async saveEdits(
    connectionId: string,
    plan: SafeEditPlan,
    edits: PendingEdit[]
  ): Promise<SaveEditsResult> {
    const s = await this.connections.ensureSession(connectionId)
    return s.saveEdits(plan, edits)
  }

  private async record(
    connectionId: string,
    sql: string,
    result: ExecuteResult | undefined,
    error: QueryErrorInfo | undefined
  ): Promise<void> {
    try {
      await this.history.add({
        connectionId,
        sql,
        success: !error,
        kind: result?.kind ?? 'UNKNOWN',
        durationMs: error ? undefined : result?.durationMs,
        resultCount: result?.page?.fetched ?? result?.rowsAffected,
        errorMessage: error?.message
      })
    } catch {
      /* history must never break query execution */
    }
  }
}