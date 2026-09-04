// Integration: lazy metadata explorer against real PostgreSQL catalogs.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { pgAvailable, seedDatabase, connectSession } from './helpers'
import type { DriverSession } from '@main/database/DatabaseDriver'

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

describe.skipIf(!hasPg)('Explorer tree', () => {
  it('lists root sections', async () => {
    const roots = await session.explore({ kind: 'roots' })
    expect(roots.map((r) => r.kind)).toEqual(['databases', 'schemas', 'extensions'])
  })

  it('lists databases including the test database', async () => {
    const dbs = await session.explore({ kind: 'databases' })
    expect(dbs.map((d) => d.name)).toContain('dbforge_test')
  })

  it('lists user schemas including public', async () => {
    const schemas = await session.explore({ kind: 'schemas' })
    const names = schemas.map((s) => s.name)
    expect(names).toContain('public')
    expect(names).not.toContain('pg_catalog')
  })

  it('lists tables, views and materialized views per schema', async () => {
    const tables = (await session.explore({ kind: 'schema-tables', schema: 'public' })).map((n) => n.name)
    expect(tables).toContain('users')
    expect(tables).toContain('order_items')
    expect(tables).toContain('no_pk_table')

    const views = (await session.explore({ kind: 'schema-views', schema: 'public' })).map((n) => n.name)
    expect(views).toContain('v_users')

    const matviews = (await session.explore({ kind: 'schema-matviews', schema: 'public' })).map((n) => n.name)
    expect(matviews).toContain('mv_user_stats')
  })

  it('lists columns with types and pk flags', async () => {
    const cols = await session.tableColumns('public', 'users')
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]))
    expect(byName.id.isPk).toBe(true)
    expect(byName.id.dataType).toBe('integer')
    expect(byName.email.nullable).toBe(true)
    expect(byName.created_at.dataType).toMatch(/timestamp/)
  })

  it('lists indexes including the primary key index', async () => {
    const nodes = await session.explore({ kind: 'table-indexes', schema: 'public', table: 'users' })
    expect(nodes.map((n) => n.name)).toContain('users_pkey')
  })

  it('lists foreign keys on order_items', async () => {
    const nodes = await session.explore({ kind: 'table-fks', schema: 'public', table: 'order_items' })
    expect(nodes.length).toBe(1)
    expect(nodes[0].comment).toMatch(/REFERENCES/i)
  })

  it('lists sequences, functions and extensions', async () => {
    const seqs = (await session.explore({ kind: 'schema-sequences', schema: 'public' })).map((n) => n.name)
    expect(seqs).toContain('seq_test')

    const fns = (await session.explore({ kind: 'schema-functions', schema: 'public' })).map((n) => n.name)
    expect(fns.some((n) => n.startsWith('add_one('))).toBe(true)

    const exts = (await session.explore({ kind: 'schema-extensions', schema: '' })).map((n) => n.name)
    expect(exts).toContain('plpgsql')
  })

  it('refreshes metadata when forced', async () => {
    const first = await session.explore({ kind: 'schemas' }, false)
    const second = await session.explore({ kind: 'schemas' }, true)
    expect(second.map((s) => s.name)).toEqual(first.map((s) => s.name))
  })
})
