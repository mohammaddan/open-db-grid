import { describe, expect, it } from 'vitest'
import {
  splitSqlStatements,
  statementAtOffset,
  statementsForSelection
} from '@shared/sql/splitter'

describe('splitSqlStatements', () => {
  it('splits simple statements and records offsets', () => {
    const sql = 'select 1; select 2;'
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toMatchObject({ text: 'select 1', terminator: ';', index: 0 })
    expect(stmts[1]).toMatchObject({ text: 'select 2', terminator: ';', index: 1 })
    expect(sql.slice(stmts[0].start, stmts[0].end)).toBe('select 1;')
    expect(sql.slice(stmts[1].start, stmts[1].end)).toBe(' select 2;')
  })

  it('ignores semicolons inside single-quoted strings', () => {
    const stmts = splitSqlStatements("select 'a;b'; select 2;")
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toBe("select 'a;b'")
  })

  it('handles escaped quotes and doubled quotes', () => {
    expect(splitSqlStatements("select E'a\\'b'; select 2;")).toHaveLength(2)
    expect(splitSqlStatements("select 'it''s'; select 2;")).toHaveLength(2)
  })

  it('ignores semicolons inside double-quoted identifiers', () => {
    const stmts = splitSqlStatements('select "a;b" from t; select 2;')
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toBe('select "a;b" from t')
  })

  it('keeps dollar-quoted function bodies intact', () => {
    const sql =
      'create function f() returns void as $$ begin perform 1; perform 2; end; $$ language plpgsql; select 3;'
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toContain('perform 1;')
    expect(stmts[0].text).toContain('end;')
    expect(stmts[1].text).toBe('select 3')
  })

  it('supports tagged dollar quotes', () => {
    const sql = "select $fn$ body ; with $fn$::text; select 2;"
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toContain('$fn$ body ; with $fn$::text')
  })

  it('handles nested block comments', () => {
    const sql = '/* outer /* inner ; */ still comment ; */ select 1; select 2;'
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toBe('select 1')
  })

  it('handles line comments', () => {
    const sql = '-- a comment ; with semicolon\nselect 1; -- trailing\nselect 2;'
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
  })

  it('keeps an unterminated final statement without a terminator', () => {
    const stmts = splitSqlStatements('select 1; select 2')
    expect(stmts).toHaveLength(2)
    expect(stmts[1]).toMatchObject({ text: 'select 2', terminator: '' })
  })

  it('returns an empty list for comments-only input', () => {
    expect(splitSqlStatements('-- just a comment')).toHaveLength(0)
    expect(splitSqlStatements('/* block */')).toHaveLength(0)
  })
})

describe('statementAtOffset', () => {
  const sql = 'select 1;\nselect 2;\nselect 3;'

  it('finds the statement under the caret', () => {
    expect(statementAtOffset(sql, 2)?.text).toBe('select 1')
    expect(statementAtOffset(sql, 12)?.text).toBe('select 2')
    expect(statementAtOffset(sql, 23)?.text).toBe('select 3')
  })

  it('falls back to the last statement for an out-of-range offset', () => {
    expect(statementAtOffset(sql, sql.length + 50)?.text).toBe('select 3')
  })
})

describe('statementsForSelection', () => {
  const sql = 'select 1; select 2; select 3;'

  it('returns statements intersecting the selection', () => {
    const start = sql.indexOf('select 2')
    const end = sql.indexOf('select 3') + 5
    const stmts = statementsForSelection(sql, start, end)
    expect(stmts.map((s) => s.text)).toEqual(['select 2', 'select 3'])
  })

  it('falls back to the caret statement without a selection', () => {
    const stmts = statementsForSelection(sql, 2, 2)
    expect(stmts.map((s) => s.text)).toEqual(['select 1'])
  })
})
