import { describe, expect, it } from 'vitest'
import { formatSql, dialectForEngine } from '@shared/sql/formatter'
import { DEFAULT_SETTINGS } from '@shared/models/settings'

describe('formatSql', () => {
  it('formats a sloppy statement with configurable indentation and case', () => {
    const out = formatSql({
      sql: "select id,name,email from users where status='active' order by created_at desc",
      dialect: 'postgresql',
      settings: { ...DEFAULT_SETTINGS.formatting, indent: '    ', keywordCase: 'upper' }
    })
    expect(out).toContain('SELECT')
    expect(out).toContain('FROM')
    expect(out).toContain('users')
    expect(out).toContain('WHERE')
    expect(out).toContain("status = 'active'")
    expect(out).toContain('ORDER BY')
    expect(out).toContain('created_at DESC')
    expect(out.split('\n').some((l) => l.startsWith('    id,'))).toBe(true)
  })

  it('honors lowercase keywords', () => {
    const out = formatSql({
      sql: 'SELECT 1',
      dialect: 'postgresql',
      settings: { ...DEFAULT_SETTINGS.formatting, keywordCase: 'lower' }
    })
    expect(out).toContain('select')
  })

  it('keeps string literals intact', () => {
    const out = formatSql({
      sql: "select 'a  b' from t",
      dialect: 'postgresql',
      settings: DEFAULT_SETTINGS.formatting
    })
    expect(out).toContain("'a  b'")
  })

  it('returns malformed SQL untouched instead of throwing', () => {
    const broken = 'select from where ((('
    expect(formatSql({ sql: broken, dialect: 'postgresql', settings: DEFAULT_SETTINGS.formatting })).toBe(broken)
  })
})

describe('dialectForEngine', () => {
  it('maps engines to formatter languages', () => {
    expect(dialectForEngine('postgresql')).toBe('postgresql')
    expect(dialectForEngine('mysql')).toBe('mysql')
    expect(dialectForEngine('unknown-engine')).toBe('postgresql')
  })
})
