import type { SslOptions } from '@shared/models/connection'
import type { ExecuteResult } from '@shared/models/result'

export function buildPgSsl(ssl: SslOptions): boolean | { rejectUnauthorized: boolean } {
  switch (ssl.mode) {
    case 'disable':
      return false
    case 'prefer':
    case 'require':
      return true
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true }
    default:
      return false
  }
}

export function mapResultKind(kind: string): ExecuteResult['kind'] {
  switch (kind) {
    case 'SELECT':
    case 'SHOW':
      return 'SELECT'
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
    case 'COPY':
      return 'DML'
    case 'CREATE':
    case 'ALTER':
    case 'DROP':
    case 'TRUNCATE':
    case 'GRANT':
    case 'REVOKE':
    case 'COMMENT':
      return 'DDL'
    default:
      return 'UTILITY'
  }
}