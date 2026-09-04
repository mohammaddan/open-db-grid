// SQL statement classifier.
//
// IMPORTANT: this module is a UX aid only (danger-confirm dialogs, read-only
// hints, result meta labels). It is NOT a security boundary. Read-only
// enforcement is guaranteed by the database engine
// (`default_transaction_read_only=on`) inside the driver, and safe edits use
// parameterized SQL with verified primary keys.

export type StatementKind =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'MERGE'
  | 'TRUNCATE'
  | 'CREATE'
  | 'ALTER'
  | 'DROP'
  | 'GRANT'
  | 'REVOKE'
  | 'BEGIN'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'SET'
  | 'SHOW'
  | 'EXPLAIN'
  | 'VACUUM'
  | 'ANALYZE_TABLE'
  | 'CALL'
  | 'COPY'
  | 'DO'
  | 'COMMENT'
  | 'UTILITY'
  | 'UNKNOWN'

export interface ClassifiedStatement {
  kind: StatementKind
  /** would modify data or schema */
  isModifying: boolean
  /** requires a confirmation dialog by default */
  isDangerous: boolean
  /** DML missing a WHERE clause (DELETE FROM users; / UPDATE users SET …) */
  isBareDml: boolean
  /** first keyword consumed */
  keyword: string
  /** statement body after the leading keyword (trimmed) */
  rest: string
  /** can produce rows */
  producesResult: boolean
}

const MODIFYING = new Set<StatementKind>([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'TRUNCATE',
  'CREATE',
  'ALTER',
  'DROP',
  'GRANT',
  'REVOKE',
  'VACUUM',
  'ANALYZE_TABLE',
  'CALL',
  'COPY',
  'DO',
  'COMMENT'
])

const DANGEROUS = new Set<StatementKind>(['DROP', 'TRUNCATE'])

const RESULT_PRODUCING = new Set<StatementKind>(['SELECT', 'SHOW', 'EXPLAIN'])

/**
 * Lightweight tokenization sufficient for leading-keyword analysis.
 * Handles quotes, dollar-quotes, comments and punctuation.
 */
export function sqlTokens(sql: string): string[] {
  const tokens: string[] = []
  const buf: string[] = []
  let i = 0
  let inLine = false
  let inBlock = false

  const flush = (): void => {
    if (buf.length > 0) {
      tokens.push(buf.join(''))
      buf.length = 0
    }
  }

  const isWordChar = (c: string | undefined): boolean =>
    c !== undefined && /[A-Za-z0-9_$]/.test(c)

  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]

    if (!inLine && !inBlock && c === '-' && n === '-') {
      flush()
      tokens.push('--')
      inLine = true
      i += 2
      continue
    }
    if (!inLine && !inBlock && c === '/' && n === '*') {
      flush()
      tokens.push('/*')
      inBlock = true
      i += 2
      continue
    }
    if (inLine) {
      if (c === '\n') inLine = false
      i++
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false
        i += 2
        continue
      }
      i++
      continue
    }

    if (c === "'" || c === '"') {
      flush()
      const quote = c
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) {
          j += 2
          continue
        }
        if (sql[j] === quote) {
          j++
          break
        }
        if (quote === "'" && sql[j] === '\\' && j + 1 < sql.length) {
          j += 2
          continue
        }
        j++
      }
      tokens.push(sql.slice(i, j))
      i = j
      continue
    }

    if (c === '$') {
      const tagEnd = scanDollarOpen(sql, i)
      if (tagEnd > i) {
        flush()
        const tag = sql.slice(i + 1, tagEnd - 1)
        let j = tagEnd
        while (j < sql.length) {
          if (sql[j] === '$') {
            if (tag.length === 0 || sql.slice(j, j + tag.length + 2) === `$${tag}$`) {
              j += tag.length === 0 ? 1 : tag.length + 2
              break
            }
          }
          j++
        }
        tokens.push(sql.slice(i, j))
        i = j
        continue
      }
    }

    if (/\s/.test(c)) {
      flush()
      i++
      continue
    }
    if ('(),;.'.includes(c)) {
      flush()
      tokens.push(c)
      i++
      continue
    }
    if (!isWordChar(c)) {
      flush()
      tokens.push(c)
      i++
      continue
    }
    buf.push(c)
    i++
  }
  flush()
  return tokens
}

function scanDollarOpen(input: string, index: number): number {
  let j = index + 1
  const start = j
  while (j < input.length) {
    const c = input[j]
    if (c === '$') {
      if (j === start) return j + 1
      const tag = input.slice(start, j)
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tag)) return j + 1
      return -1
    }
    if (!/^[A-Za-z0-9_]$/.test(c)) return -1
    j++
  }
  return -1
}

/** Classify a single leading keyword. */
function classifyKeywordValue(raw: string): StatementKind {
  const up = raw.toUpperCase()
  switch (up) {
    case 'SELECT':
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
    case 'TRUNCATE':
    case 'CREATE':
    case 'ALTER':
    case 'DROP':
    case 'GRANT':
    case 'REVOKE':
    case 'BEGIN':
    case 'COMMIT':
    case 'ROLLBACK':
    case 'SET':
    case 'SHOW':
    case 'EXPLAIN':
    case 'VACUUM':
    case 'CALL':
    case 'COPY':
    case 'DO':
    case 'COMMENT':
    case 'TABLE':
    case 'VALUES':
    case 'REFRESH':
    case 'PREPARE':
    case 'EXECUTE':
    case 'DEALLOCATE':
    case 'DISCARD':
    case 'RESET':
    case 'LOCK':
    case 'DECLARE':
    case 'FETCH':
    case 'UNLISTEN':
    case 'NOTIFY':
      return up as StatementKind
    case 'ANALYZE':
      return 'ANALYZE_TABLE'
    default:
      return 'UNKNOWN'
  }
}

export interface LeadingMatch {
  keyword: string
  kind: StatementKind
  /** token index right after the leading keyword is consumed */
  nextIndex: number
}

/** Determines the statement's leading keyword + kind. */
export function leadingKeyword(sql: string): LeadingMatch {
  const tokens = sqlTokens(sql)
  let start = 0
  while (start < tokens.length && (tokens[start] === '--' || tokens[start] === '/*')) start++
  const first = tokens[start]?.toUpperCase() ?? ''
  const kind = classifyKeywordValue(first)

  if (first === 'EXPLAIN') {
    let i = start + 1
    if (tokens[i] === '(') {
      let depth = 0
      while (i < tokens.length) {
        if (tokens[i] === '(') depth++
        if (tokens[i] === ')') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        i++
      }
    }
    while (i < tokens.length) {
      const t = tokens[i].toUpperCase()
      if (['ANALYZE', 'VERBOSE', 'BUFFERS', 'TIMING', 'SUMMARY', 'SETTINGS', 'WAL', 'FORMAT'].includes(t)) {
        i++
        continue
      }
      break
    }
    return { keyword: 'EXPLAIN', kind: 'EXPLAIN', nextIndex: i }
  }

  if (first === 'WITH') {
    let depth = 0
    for (let i = start + 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === '(') depth++
      else if (t === ')') depth--
      else if (depth === 0 && /^[A-Za-z_]+$/.test(t)) {
        const ck = classifyKeywordValue(t)
        if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(ck)) {
          return { keyword: first, kind: ck, nextIndex: i + 1 }
        }
      }
    }
    return { keyword: first, kind: 'SELECT', nextIndex: start + 1 }
  }

  if (first === 'SELECT' || first === 'VALUES' || first === 'TABLE') {
    return { keyword: first, kind: 'SELECT', nextIndex: start + 1 }
  }

  if (first === '' ) {
    return { keyword: '', kind: 'UNKNOWN', nextIndex: start }
  }

  return { keyword: first, kind, nextIndex: start + 1 }
}
/**
 * Full-featured classification. Used for UI labels, danger confirmation and
 * read-only UX hints. See module docstring re: security boundary.
 */
export function classifyStatement(sql: string): ClassifiedStatement {
  const lead = leadingKeyword(sql)
  const kind: StatementKind = lead.kind
  const keyword = lead.keyword

  const rest = stripLeadingKeyword(sql, keyword)
  const upperRest = rest.toUpperCase()
  const hasWhere = /\bWHERE\b/.test(upperRest)

  let isBareDml = false
  if ((kind === 'DELETE' || kind === 'UPDATE') && !hasWhere) isBareDml = true
  const isDangerous = DANGEROUS.has(kind) || isBareDml

  let producesResult = RESULT_PRODUCING.has(kind)
  if (kind === 'UTILITY' || kind === 'UNKNOWN') {
    producesResult = /^\s*(VALUES|TABLE)\b/i.test(rest)
  }

  return {
    kind,
    isModifying: MODIFYING.has(kind),
    isDangerous,
    isBareDml,
    keyword,
    rest: rest.trim(),
    producesResult
  }
}

function stripLeadingKeyword(sql: string, keyword: string): string {
  if (!keyword) return sql.trim()
  const upper = sql.toUpperCase()
  const idx = upper.indexOf(keyword.toUpperCase())
  if (idx < 0) return sql.trim()
  return sql.slice(idx + keyword.length).trim()
}

/** Guards used by the renderer when a connection is marked read-only. */
export function isReadOnlyBlocked(sql: string): { blocked: boolean; reason?: string } {
  const c = classifyStatement(sql)
  if (c.kind === 'BEGIN' || c.kind === 'COMMIT' || c.kind === 'ROLLBACK' || c.kind === 'SET') {
    return { blocked: false }
  }
  if (c.kind === 'UNKNOWN') {
    return { blocked: false }
  }
  if (c.isModifying) {
    return {
      blocked: true,
      reason: `"${c.kind}" modifies data/schema and is not allowed on a read-only connection.`
    }
  }
  return { blocked: false }
}