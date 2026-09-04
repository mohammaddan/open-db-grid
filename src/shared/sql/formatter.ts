// SQL formatter service. Wraps sql-formatter (battle-tested) so formatting
// config and the SQL dialect can evolve per database engine.

import { format as sqlFormat, type FormatOptionsWithLanguage, type SqlLanguage } from 'sql-formatter'
import type { FormattingSettings } from '@shared/models/settings'

export type SqlDialectId = 'postgresql' | 'mysql' | 'sqlite' | 'mssql'

/** Maps our connection driver to sql-formatter's language identifiers. */
export function dialectForEngine(engine: 'postgresql' | string): SqlDialectId {
  switch (engine) {
    case 'postgresql':
      return 'postgresql'
    case 'mysql':
      return 'mysql'
    case 'sqlite':
      return 'sqlite'
    case 'mssql':
      return 'mssql'
    default:
      return 'postgresql'
  }
}

export interface FormatRequest {
  sql: string
  dialect?: SqlDialectId
  settings: FormattingSettings
}

export function formatSql(request: FormatRequest): string {
  const { sql, settings } = request
  if (!sql.trim()) return sql

  const options: FormatOptionsWithLanguage = {
    language: (request.dialect ?? 'postgresql') as SqlLanguage,
    tabWidth: settings.indent.length > 0 ? settings.indent.length : 4,
    useTabs: false,
    keywordCase: settings.keywordCase,
    linesBetweenQueries: settings.linesBetweenQueries
  }

  try {
    return sqlFormat(sql, options) + '\n'
  } catch (err) {
    // Let malformed SQL pass through untouched rather than failing the edit.
    console.warn('[formatter] could not format SQL:', err)
    return sql
  }
}

/** Format only the selected range (keeps the rest intact). */
export function formatSelection(sql: string, selectionStart: number, selectionEnd: number, settings: FormattingSettings): string {
  if (selectionEnd <= selectionStart) return sql
  const selected = sql.slice(selectionStart, selectionEnd)
  const formatted = formatSql({ sql: selected, dialect: 'postgresql', settings })
  return sql.slice(0, selectionStart) + formatted + sql.slice(selectionEnd)
}