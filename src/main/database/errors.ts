// Database error mapping.
//
// Converts driver-level errors (node-postgres DatabaseError, timeouts, network
// failures, our own DbError) into structured QueryErrorInfo that the renderer
// can display with SQLSTATE / position / detail / hint / context.
//
// NEVER include passwords here: any field that contains a connection string is
// scrubbed before being returned to the UI.

import type { QueryErrorInfo } from '@shared/models/result'

/** SQLSTATE classes that are safe to display without scrubbing. */
export class DatabaseError extends Error {
  readonly info: QueryErrorInfo
  readonly causeCode?: string

  constructor(info: QueryErrorInfo, causeCode?: string) {
    super(info.message)
    this.name = 'DatabaseError'
    this.info = info
    this.causeCode = causeCode
  }
}

interface PgErrorLike {
  message?: string
  code?: string
  severity?: string
  detail?: string
  hint?: string
  position?: string
  context?: string
  sqlState?: string
  stack?: string
}

export function isQueryError(err: unknown): err is DatabaseError {
  return err instanceof DatabaseError
}

export function toQueryErrorInfo(err: unknown): QueryErrorInfo {
  if (err instanceof DatabaseError) return err.info

  const pg = err as PgErrorLike
  if (pg && typeof pg.message === 'string') {
    return {
      message: pg.message,
      severity: pg.severity,
      sqlState: pg.code ?? pg.sqlState,
      detail: pg.detail,
      hint: pg.hint,
      position: parsePosition(pg.position),
      context: pg.context,
      code: pg.code
    }
  }

  if (err instanceof Error) {
    return { message: cleanErrorMessage(err.message), code: (err as { code?: string }).code }
  }
  return { message: cleanErrorMessage(String(err)) }
}

function parsePosition(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Scrubs connection-string-like content (passwords) out of error text. */
export function cleanErrorMessage(message: string): string {
  return message
    // password=xxx or password: xxx in connection strings
    .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, '$1*****')
    // host:port@user
    .replace(/[^@\s:]+:[^@\s]+@/g, '*****@')
    .trim()
}

export function errorMessage(err: unknown): string {
  return toQueryErrorInfo(err).message
}