import { describe, expect, it } from 'vitest'
import {
  planSafeEdit,
  buildParameterizedUpdate,
  describeDiff,
  type TableColumnInfo
} from '@shared/sql/editplanner'
import type { QueryColumn } from '@shared/models/explorer'

const USERS_COLUMNS: TableColumnInfo[] = [
  { name: 'id', dataType: 'integer', pk: true, nullable: false },
  { name: 'name', dataType: 'text', pk: false, nullable: true },
  { name: 'email', dataType: 'text', pk: false, nullable: true }
]

const lookup = async (
  schema: string | null,
  table: string
): Promise<{ schema: string; columns: TableColumnInfo[] } | null> => {
  // The planner hands unqualified table names to us with schema === null; a
  // real driver resolves them against search_path — this stub pretends it did.
  const resolved = schema ?? 'public'
  if (resolved === 'public' && table === 'users') return { schema: resolved, columns: USERS_COLUMNS }
  return null
}

const cols = (...names: string[]): QueryColumn[] =>
  names.map((name) => ({ name, dataType: 'text', nullable: true }))

describe('planSafeEdit', () => {
  it('plans an editable result for a plain single-table SELECT with pk', async () => {
    const plan = await planSafeEdit({
      sql: 'select id, name, email from users',
      isSelectish: true,
      resultColumns: cols('id', 'name', 'email'),
      lookup
    })
    expect(plan.editable).toBe(true)
    expect(plan.table).toBe('users')
    expect(plan.pkColumns).toEqual(['id'])
    expect(plan.columns.find((c) => c.key === 'name')?.editable).toBe(true)
    expect(plan.columns.find((c) => c.key === 'id')?.editable).toBe(false)
  })

  it('rejects aggregates', async () => {
    const plan = await planSafeEdit({
      sql: 'select name, count(*) from users group by name',
      isSelectish: true,
      resultColumns: cols('name', 'count'),
      lookup
    })
    expect(plan.editable).toBe(false)
    expect(plan.reason).toMatch(/aggregate/i)
  })

  it('rejects joins', async () => {
    const plan = await planSafeEdit({
      sql: 'select u.id, o.total from users u join orders o on o.user_id = u.id',
      isSelectish: true,
      resultColumns: cols('id', 'total'),
      lookup
    })
    expect(plan.editable).toBe(false)
  })

  it('rejects CTEs and subqueries', async () => {
    const cte = await planSafeEdit({
      sql: 'with t as (select id from users) select id from t',
      isSelectish: true,
      resultColumns: cols('id'),
      lookup
    })
    const sub = await planSafeEdit({
      sql: 'select id from users where id in (select id from admins)',
      isSelectish: true,
      resultColumns: cols('id'),
      lookup
    })
    expect(cte.editable).toBe(false)
    expect(sub.editable).toBe(false)
  })

  it('rejects results missing the primary key', async () => {
    const plan = await planSafeEdit({
      sql: 'select name, email from users',
      isSelectish: true,
      resultColumns: cols('name', 'email'),
      lookup
    })
    expect(plan.editable).toBe(false)
    expect(plan.reason).toMatch(/primary-key/i)
  })

  it('rejects unknown tables and non-SELECT statements', async () => {
    const unknown = await planSafeEdit({
      sql: 'select id from does_not_exist',
      isSelectish: true,
      resultColumns: cols('id'),
      lookup
    })
    const nonSelect = await planSafeEdit({
      sql: 'update users set name = $1 where id = $2',
      isSelectish: false,
      resultColumns: cols('id'),
      lookup
    })
    expect(unknown.editable).toBe(false)
    expect(nonSelect.editable).toBe(false)
  })
})

describe('buildParameterizedUpdate', () => {
  it('binds every value as a parameter — no string concatenation', () => {
    const built = buildParameterizedUpdate(
      'public',
      'users',
      [
        { column: 'name', newValue: 'John Smith' },
        { column: 'email', newValue: 'new@example.com' }
      ],
      [{ column: 'id', value: 10 }]
    )
    expect(built).not.toBeNull()
    expect(built!.sql).toBe(
      'UPDATE "public"."users" SET "name" = $1, "email" = $2 WHERE "id" = $3'
    )
    expect(built!.params).toEqual(['John Smith', 'new@example.com', 10])
  })

  it('quotes identifiers containing double quotes safely', () => {
    const built = buildParameterizedUpdate(
      'odd"schema',
      'we"ir"d',
      [{ column: 'na"me', newValue: 'x' }],
      [{ column: 'i"d', value: 1 }]
    )
    expect(built!.sql).toContain('"na""me" = $1')
    expect(built!.sql).toContain('"i""d" = $2')
    expect(built!.params).toEqual(['x', 1])
  })

  it('returns null for empty edits or empty key', () => {
    expect(buildParameterizedUpdate('public', 'users', [], [{ column: 'id', value: 1 }])).toBeNull()
    expect(
      buildParameterizedUpdate('public', 'users', [{ column: 'name', newValue: 'x' }], [])
    ).toBeNull()
  })
})

describe('describeDiff', () => {
  it('formats old → new with NULL handling', () => {
    expect(describeDiff('John', 'John Smith')).toBe('"John" → "John Smith"')
    expect(describeDiff(null, 42)).toBe('NULL → 42')
  })
})
