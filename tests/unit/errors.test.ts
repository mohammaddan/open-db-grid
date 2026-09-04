import { describe, expect, it } from 'vitest'
import { toQueryErrorInfo, cleanErrorMessage, DatabaseError } from '@main/database/errors'

describe('toQueryErrorInfo', () => {
  it('maps node-postgres DatabaseError fields', () => {
    const info = toQueryErrorInfo({
      message: 'column "nope" does not exist',
      severity: 'ERROR',
      code: '42703',
      position: '42',
      detail: 'Some detail',
      hint: 'Maybe you meant "id"?',
      context: 'PL/pgSQL function f()'
    })
    expect(info.message).toBe('column "nope" does not exist')
    expect(info.sqlState).toBe('42703')
    expect(info.position).toBe(42)
    expect(info.detail).toBe('Some detail')
    expect(info.hint).toBe('Maybe you meant "id"?')
    expect(info.context).toBe('PL/pgSQL function f()')
  })

  it('parses invalid positions safely', () => {
    expect(toQueryErrorInfo({ message: 'x', position: 'abc' }).position).toBeUndefined()
    expect(toQueryErrorInfo({ message: 'x', position: '-3' }).position).toBeUndefined()
  })

  it('passes DatabaseError info through unchanged', () => {
    const err = new DatabaseError({ message: 'boom', sqlState: '25006' })
    expect(toQueryErrorInfo(err).sqlState).toBe('25006')
    expect(err.name).toBe('DatabaseError')
  })

  it('handles plain Errors and unknown values', () => {
    expect(toQueryErrorInfo(new Error('plain')).message).toBe('plain')
    expect(toQueryErrorInfo('weird').message).toBe('weird')
  })
})

describe('cleanErrorMessage', () => {
  it('scrubs passwords from connection strings — secrets never leak', () => {
    expect(cleanErrorMessage('could not connect: password=sekret host=pg')).not.toContain('sekret')
    expect(cleanErrorMessage('password: hunter2')).not.toContain('hunter2')
    expect(cleanErrorMessage('user admin:hunter2@db.example.com failed')).not.toContain('hunter2')
  })
})
