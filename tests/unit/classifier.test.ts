import { describe, expect, it } from 'vitest'
import { classifyStatement, isReadOnlyBlocked } from '@shared/sql/classifier'

describe('classifyStatement', () => {
  it('classifies plain SELECT', () => {
    const c = classifyStatement('select id from users')
    expect(c.kind).toBe('SELECT')
    expect(c.isModifying).toBe(false)
    expect(c.isDangerous).toBe(false)
    expect(c.producesResult).toBe(true)
    expect(c.keyword).toBe('SELECT')
  })

  it('marks DELETE without WHERE as dangerous (bare DML)', () => {
    const c = classifyStatement('delete from users')
    expect(c.kind).toBe('DELETE')
    expect(c.isModifying).toBe(true)
    expect(c.isBareDml).toBe(true)
    expect(c.isDangerous).toBe(true)
  })

  it('marks UPDATE without WHERE as dangerous', () => {
    const c = classifyStatement("update users set status = 'x'")
    expect(c.kind).toBe('UPDATE')
    expect(c.isBareDml).toBe(true)
    expect(c.isDangerous).toBe(true)
  })

  it('does not flag DML that has a WHERE as bare', () => {
    const c = classifyStatement('delete from users where id = 1')
    expect(c.isModifying).toBe(true)
    expect(c.isBareDml).toBe(false)
    expect(c.isDangerous).toBe(false)
  })

  it('marks DROP and TRUNCATE as dangerous', () => {
    expect(classifyStatement('drop table users').kind).toBe('DROP')
    expect(classifyStatement('drop table users').isDangerous).toBe(true)
    expect(classifyStatement('truncate table users').kind).toBe('TRUNCATE')
    expect(classifyStatement('truncate users').isDangerous).toBe(true)
  })

  it('classifies statements ignoring case, comments and whitespace', () => {
    const c = classifyStatement('  /* hello */\nDELETE\nFROM users;')
    expect(c.kind).toBe('DELETE')
    expect(c.isBareDml).toBe(true)
  })

  it('follows WITH … DELETE to the real statement kind', () => {
    const c = classifyStatement(
      'with gone as (select id from users where id < 10) delete from users using gone where users.id = gone.id'
    )
    expect(c.kind).toBe('DELETE')
    expect(c.isModifying).toBe(true)
  })

  it('classifies EXPLAIN variants', () => {
    expect(classifyStatement('explain analyze select 1').kind).toBe('EXPLAIN')
    expect(classifyStatement('explain (verbose, buffers) select 1').kind).toBe('EXPLAIN')
  })

  it('classifies transaction and session statements as safe', () => {
    expect(classifyStatement('begin').isModifying).toBe(false)
    expect(classifyStatement('commit').isModifying).toBe(false)
    expect(classifyStatement('rollback').isModifying).toBe(false)
    expect(classifyStatement("set search_path to 'public'").isModifying).toBe(false)
    expect(classifyStatement('show search_path').kind).toBe('SHOW')
  })

  it('classifies DDL kinds', () => {
    expect(classifyStatement('create table t (id int)').kind).toBe('CREATE')
    expect(classifyStatement('alter table t add column x int').kind).toBe('ALTER')
    expect(classifyStatement('create index i on t (id)').isModifying).toBe(true)
  })
})

describe('isReadOnlyBlocked (UX aid only)', () => {
  it('blocks every modifying statement kind', () => {
    for (const sql of [
      'insert into t values (1)',
      'update t set a = 1',
      'delete from t',
      'truncate t',
      'drop table t',
      'alter table t add column x int',
      'create table t (id int)',
      'grant all on t to public',
      'do $$ begin perform 1; end $$;',
      'comment on table t is \'x\''
    ]) {
      expect(isReadOnlyBlocked(sql).blocked, sql).toBe(true)
    }
  })

  it('allows reads and session statements', () => {
    for (const sql of [
      'select 1',
      'select * from t where a > 1',
      'explain select 1',
      'show search_path',
      'begin',
      'commit',
      'rollback',
      'set statement_timeout to 5000'
    ]) {
      expect(isReadOnlyBlocked(sql).blocked, sql).toBe(false)
    }
  })

  it('includes a human-readable reason when blocked', () => {
    const r = isReadOnlyBlocked('delete from t')
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain('DELETE')
  })

  it('is not a security boundary (unknown statements fail open by design)', () => {
    // The engine-level default_transaction_read_only is the real guarantee.
    expect(isReadOnlyBlocked('vacuum full').blocked).toBe(true) // known modifying
    expect(isReadOnlyBlocked('some future keyword').blocked).toBe(false)
  })
})
