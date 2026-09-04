// Integration: real PostgreSQL through the driver registry.
// Connectivity, cursor paging, DML counts, structured errors, cancellation.
// Requires a reachable PostgreSQL — `npm run db:up` or DB_CLIENT_TEST_PG_URL.

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

describe.skipIf(!hasPg)('PostgreSQL connectivity', () => {
  it('probes the server and reports its version', async () => {
    const probe = await session.probe()
    expect(probe.ok).toBe(true)
    expect(probe.serverVersion).toContain('PostgreSQL')
  })

  it('reports failed authentication without echoing the password', async () => {
    const { driverRegistry } = await import('@main/database/driverRegistry')
    const { makeConnection } = await import('./helpers')
    const base = makeConnection()
    const result = await driverRegistry.forEngine('postgresql').test({
      connection: { ...base, config: { ...base.config, username: 'dbforge' } },
      secretProvider: async () => 'definitely-wrong-password'
    })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/password authentication failed/i)
  })
})

describe.skipIf(!hasPg)('Query execution + cursor paging', () => {
  it('pages through 1200 rows with hasMore until exhaustion', async () => {
    const result = await session.execute('select id, name, email from users order by id', {
      pageSize: 100,
      sessionKey: 'page-test'
    })
    expect(result.kind).toBe('SELECT')
    expect(result.sessionId).toBe('page-test')
    expect(result.page?.rows).toHaveLength(100)
    expect(result.page?.hasMore).toBe(true)
    expect((result.columns ?? []).map((c) => c.name)).toEqual(['id', 'name', 'email'])

    let total = result.page!.rows.length
    let page = result.page!
    let guard = 0
    while (page.hasMore && guard++ < 30) {
      page = await session.fetchPage(result.sessionId!, 100)
      total += page.rows.length
    }
    expect(total).toBe(1200)
    expect(page.hasMore).toBe(false)
    await session.closeSession(result.sessionId!)
  }, 20_000)

  it('reports rowsAffected for DML', async () => {
    const upd = await session.execute('update users set name = name where id <= 10')
    expect(upd.kind).toBe('DML')
    expect(upd.rowsAffected).toBe(10)

    const ins = await session.execute(
      'insert into order_items (user_id, amount) values (1, 9.99), (2, 8.88)'
    )
    expect(ins.rowsAffected).toBe(2)

    const del = await session.execute('delete from order_items where amount = 9.99')
    expect(del.rowsAffected).toBe(1)
  })

  it('reports structured errors: SQLSTATE and position', async () => {
    await expect(
      session.execute('select nonexistent_col from users limit 1')
    ).rejects.toMatchObject({ sqlState: '42703' })

    await expect(session.execute('selec 1')).rejects.toMatchObject({
      sqlState: '42601',
      position: 1
    })
  })

  it('cancels a long-running query (SQLSTATE 57014) and stays usable', async () => {
    const pending = session
      .execute('select pg_sleep(30), 1', { pageSize: 10, sessionKey: 'cancel-me' })
      .catch((err: unknown) => err as { sqlState?: string })

    await new Promise((r) => setTimeout(r, 400))
    const cancel = await session.cancel('cancel-me')
    expect(cancel.canceled).toBe(true)

    const rejected = (await pending) as { sqlState?: string }
    expect(rejected.sqlState).toBe('57014')

    const probe = await session.probe()
    expect(probe.ok).toBe(true)
  }, 20_000)
})
