// A robust-enough PostgreSQL statement splitter.
// Handles: single quotes ('..' with '' and backslash escapes), E-strings,
// double-quoted identifiers, dollar-quoted literals ($$..$$, $tag$..$tag$),
// line comments (--), and nested block comments (/* /* */ */).

export interface SplitStatement {
  /** statement text without the trailing semicolon, trimmed */
  text: string
  /** absolute offset within the original string */
  start: number
  /** absolute end offset (exclusive), includes terminator if any */
  end: number
  /** ';' or '' for the final unterminated statement */
  terminator: string
  index: number
}

const enum St {
  Normal = 0,
  SingleQuote = 1,
  DoubleQuote = 2,
  LineComment = 3,
  BlockComment = 4,
  DollarTag = 5
}

export function splitSqlStatements(input: string): SplitStatement[] {
  const statements: SplitStatement[] = []
  let state = St.Normal
  let depth = 0
  let dollarTag = ''
  let stmtStart = 0
  let stmtIndex = 0

  const flush = (end: number, term: string): void => {
    const start = stmtStart
    const trimmed = start < end ? cleanStatementText(input.slice(start, end)) : ''
    if (trimmed.length > 0) {
      statements.push({
        text: trimmed,
        start,
        end: end + term.length,
        terminator: term,
        index: stmtIndex
      })
      stmtIndex += 1
    }
    stmtStart = end + term.length
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]

    switch (state) {
      case St.Normal: {
        if (ch === "'") {
          state = St.SingleQuote
          i++
        } else if (ch === '"') {
          state = St.DoubleQuote
          i++
        } else if (ch === '-' && next === '-') {
          state = St.LineComment
          i += 2
        } else if (ch === '/' && next === '*') {
          state = St.BlockComment
          depth = 1
          i += 2
        } else if (ch === '$') {
          const tagEnd = scanDollarTag(input, i)
          if (tagEnd > i) {
            state = St.DollarTag
            dollarTag = input.slice(i + 1, tagEnd - 1)
            i = tagEnd
          } else {
            i++
          }
        } else if (ch === ';') {
          flush(i, ';')
          i++
        } else {
          i++
        }
        break
      }

      case St.SingleQuote: {
        if (ch === '\\' && i + 1 < input.length) {
          i += 2
        } else if (ch === "'" && next === "'") {
          i += 2
        } else if (ch === "'") {
          state = St.Normal
          i++
        } else {
          i++
        }
        break
      }

      case St.DoubleQuote: {
        if (ch === '"' && next === '"') {
          i += 2
        } else if (ch === '"') {
          state = St.Normal
          i++
        } else {
          i++
        }
        break
      }

      case St.LineComment: {
        if (ch === '\n') state = St.Normal
        i++
        break
      }

      case St.BlockComment: {
        if (ch === '/' && next === '*') {
          depth++
          i += 2
        } else if (ch === '*' && next === '/') {
          depth--
          i += 2
          if (depth === 0) state = St.Normal
        } else {
          i++
        }
        break
      }

      case St.DollarTag: {
        if (ch === '$') {
          if (dollarTag.length === 0) {
            state = St.Normal
            i++
          } else {
            const maybeEnd = input.slice(i, i + dollarTag.length + 2)
            if (maybeEnd === `$${dollarTag}$`) {
              state = St.Normal
              i += dollarTag.length + 2
            } else {
              i++
            }
          }
        } else {
          i++
        }
        break
      }
    }
  }

  if (input.slice(stmtStart).trim().length > 0) {
    flush(input.length, '')
  }

  return statements
}

function scanDollarTag(input: string, dollarIndex: number): number {
  let j = dollarIndex + 1
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

/**
 * Statement text as shown to users/executed: leading whitespace and leading
 * comments are stripped (nesting-aware for block comments), trailing
 * whitespace/semicolons are stripped. Pure-comment statements become '' and
 * are dropped by flush().
 */
export function cleanStatementText(raw: string): string {
  return trimTrailingWhitespace(stripLeadingTrivia(raw))
}

/** Removes leading whitespace, line comments and (nested) block comments. */
function stripLeadingTrivia(s: string): string {
  let i = 0
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (s.startsWith('--', i)) {
      const nl = s.indexOf('\n', i)
      if (nl < 0) return ''
      i = nl + 1
      continue
    }
    if (s.startsWith('/*', i)) {
      let depth = 1
      let j = i + 2
      while (j < s.length && depth > 0) {
        if (s.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (s.startsWith('*/', j)) {
          depth--
          j += 2
        } else {
          j++
        }
      }
      if (depth > 0) return ''
      i = j
      continue
    }
    return s.slice(i)
  }
}

function trimTrailingWhitespace(raw: string): string {
  return raw.replace(/[\s;]+$/, '')
}

/** Statement(s) at a given character offset (for "execute current statement"). */
export function statementAtOffset(sql: string, offset: number): SplitStatement | undefined {
  const stmts = splitSqlStatements(sql)
  if (stmts.length === 0) return undefined
  for (const stmt of stmts) {
    const bodyEnd = stmt.end - (stmt.terminator ? stmt.terminator.length : 0)
    if (offset >= stmt.start && offset <= bodyEnd) return stmt
  }
  const last = stmts.find((s) => s.start <= offset && offset <= s.end)
  return last ?? stmts[stmts.length - 1]
}

/** Statements intersecting the selected range, or the caret statement. */
export function statementsForSelection(
  sql: string,
  selectionStart: number,
  selectionEnd: number
): SplitStatement[] {
  if (selectionEnd > selectionStart) {
    const all = splitSqlStatements(sql)
    return all.filter(
      (s) => s.start < selectionEnd && s.end - (s.terminator ? 1 : 0) > selectionStart
    )
  }
  const caret = statementAtOffset(sql, selectionStart)
  return caret ? [caret] : []
}