// Integration: safe result editing. planForSelect (PK detection, qualified AND
// unqualified tables, views/aggregates rejected) and saveEdits (parameterized
// UPDATE, pk-verified rows, skipped rows).

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { pgAvailable, seedDatabase, connectSession } from './helpers'
import type { DriverSession } from '@main/database/DatabaseDriver'
import type { PendingEdit } from '@shared/models/explorer'

const hasPg = await pgAvailable()
let session: DriverSession

beforeAll(async () => {
  if (!hasPg) return
  await seedDatabase()
  session = await connectSession()
})

afterAll(async () => {
  await session?.dispose()
})

describe.skipIf(!hasPg)('planForSelect (primary-key detection)', () => {
  it('plans a qualified single-table SELECT as editable', async () => {
    const plan = await session.planForSelect('select id, name, email from public.users', [
      'id', 'name', 'email'
    ])
    expect(plan.editable).toBe(true)
    expect(plan.schema).toBe('public')
    expect(plan.table).toBe('users')
    expect(plan.pkColumns).toEqual(['id'])
    expect(plan.columns.find((c) => c.key === 'id')?.editable).toBe(false)
    expect(plan.columns.find((c) => c.key === 'name')?.editable).toBe(true)
  })

  it('resolves unqualified table names via search_path', async () => {
    const plan = await session.planForSelect('select id, name, email from users', [
      'id', 'name', 'email'
    ])
    expect(plan.editable).toBe(true)
    expect(plan.schema).toBe('public')
    expect(plan.table).toBe('users')
  })

  it('rejects aggregate results', async () => {
    const plan = await session.planForSelect(
      'select name, count(*) from users group by name',
      ['name', 'count']
    )
    expect(plan.editable).toBe(false)
    expect(plan.reason).toMatch(/aggregate|grouping/i)
  })

  it('rejects views (cannot verify auto-updatability)', async () => {
    const plan = await session.planForSelect('select id, name from v_users', ['id', 'name'])
    expect(plan.editable).toBe(false)
    expect(plan.reason).toBeTruthy()
  })

  it('rejects results missing the primary key', async () => {
    const plan = await session.planForSelect('select name, email from users', ['name', 'email'])
    expect(plan.editable).toBe(false)
    expect(plan.reason).toMatch(/primary-key/i)
  })

  it('rejects tables without a primary key', async () => {
    const plan = await session.planForSelect('select a, b from no_pk_table', ['a', 'b'])
    expect(plan.editable).toBe(false)
    expect(plan.reason).toMatch(/no primary key/i)
  })
})

describe.skipIf(!hasPg)('saveEdits (parameterized UPDATE)', () => {
  it('applies a cell edit and writes exactly the changed row', async () => {
    const result = await session.execute(
      'select id, name, email from users where id = 10',
      { pageSize: 10, sessionKey: 'edit-1' }
    )
    const row = result.page!.rows[0]
    const originalName = row.name as string

    const plan = await session.planForSelect('select id, name, email from users', [
      'id', 'name', 'email'
    ])
    expect(plan.editable).toBe(true)

    const edit: PendingEdit = {
      rowKey: row.__rowId,
      column: 'name',
      oldValue: originalName,
      newValue: 'EDITED-NAME',
      pkValues: [{ column: 'id', value: row.id }]
    }
    const res = await session.saveEdits(plan, [edit])
    expect(res.updated).toBe(1)
    expect(res.skipped).toBe(0)
    expect(res.firstError).toBeUndefined()
    expect(res.executedStatements[0]).toMatch(
      /^UPDATE "public"\."users" SET "name" = \$1 WHERE "id" = \$2$/
    )

    const check = await session.execute('select name from users where id = 10')
    expect(check.page!.rows[0].name).toBe('EDITED-NAME')

    await session.saveEdits(plan, [
      { rowKey: row.__rowId, column: 'name', oldValue: 'EDITED-NAME', newValue: originalName, pkValues: [{ column: 'id', value: row.id }] }
    ])
    await session.closeSession(result.sessionId!)
  })

  it('keeps special characters intact (no SQL injection through values)', async () => {
    const plan = await session.planForSelect('select id, name, email from users', [
      'id', 'name', 'email'
    ])
    const nasty = "O'Brien'; drop table users; --"
    const res = await session.saveEdits(plan, [
      {
        rowKey: 1,
        column: 'name',
        oldValue: 'whatever',
        newValue: nasty,
        pkValues: [{ column: 'id', value: 11 }]
      }
    ])
    expect(res.updated).toBe(1)

    const check = await session.execute('select name from users where id = 11')
    expect(check.page!.rows[0].name).toBe(nasty)

    const count = await session.execute('select count(*)::int as n from users')
    expect(count.page!.rows[0].n).toBe(1200) // drop table did NOT execute

    await session.saveEdits(plan, [
      { rowKey: 1, column: 'name', oldValue: nasty, newValue: 'user 11', pkValues: [{ column: 'id', value: 11 }] }
    ])
  })

  it('skips rows whose primary key no longer exists', async () => {
    const plan = await session.planForSelect('select id, name from users', ['id', 'name'])
    const res = await session.saveEdits(plan, [
      {
        rowKey: 1,
        column: 'name',
        oldValue: 'x',
        newValue: 'y',
        pkValues: [{ column: 'id', value: 999999 }]
      }
    ])
    expect(res.updated).toBe(0)
    expect(res.skipped).toBe(1)
  })

  it('rejects edits on read-only connections before any SQL runs', async () => {
    const ro = await connectSession({ id: 'it-ro-edit', accessMode: 'read-only' })
    try {
      const plan = await ro.planForSelect('select id, name from users', ['id', 'name'])
      expect(plan.editable).toBe(true) // plan is fine — the WRITE is what is blocked
      await expect(
        ro.saveEdits(plan, [
          { rowKey: 1, column: 'name', oldValue: 'a', newValue: 'b', pkValues: [{ column: 'id', value: 1 }] }
        ])
      ).rejects.toMatchObject({ sqlState: '25006' })
    } finally {
      await ro.dispose()
    }
  })
})
