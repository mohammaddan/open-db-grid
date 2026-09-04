// Integration: read-only enforcement (driver pre-flight + ENGINE guarantee),
// transactions (begin/commit/rollback, BEGIN READ ONLY), export streaming,
// first-class Browse Table Data and EXPLAIN/EXPLAIN ANALYZE.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pgAvailable, seedDatabase, connectSession } from './helpers'
import type { DriverSession } from '@main/database/DatabaseDriver'

const hasPg = await pgAvailable()
let session: DriverSession
let roSession: DriverSession

beforeAll(async () => {
  if (!hasPg) return
  await seedDatabase()
  session = await connectSession()
  roSession = await connectSession({ id: 'it-ro', accessMode: 'read-only' })
})

afterAll(async () => {
  await session?.dispose()
  await roSession?.dispose()
})

describe.skipIf(!hasPg)('Read-only enforcement (engine level)', () => {
  it('sets default_transaction_read_only on the server session', async () => {
    const result = await roSession.execute('show default_transaction_read_only')
    expect(result.page?.rows[0].default_transaction_read_only).toBe('on')
  })

  it('pre-blocks INSERT/UPDATE/DELETE with SQLSTATE 25006', async () => {
    await expect(
      roSession.execute("insert into users (name) values ('x')")
    ).rejects.toMatchObject({ sqlState: '25006' })
    await expect(
      roSession.execute("update users set name = 'x' where id = 1")
    ).rejects.toMatchObject({ sqlState: '25006' })
    await expect(roSession.execute('delete from users where id = 1')).rejects.toMatchObject({
      sqlState: '25006'
    })
  })

  it('the ENGINE also refuses writes the classifier misses (nextval mutates)', async () => {
    // nextval() is a sequence mutation the keyword classifier does not know —
    // default_transaction_read_only makes PostgreSQL itself reject it.
    await expect(roSession.execute("select nextval('seq_test')")).rejects.toMatchObject({
      sqlState: '25006'
    })
  })

  it('still allows reads on read-only connections', async () => {
    const result = await roSession.execute('select id from users order by id limit 3')
    expect(result.page?.rows).toHaveLength(3)
  })
})

describe.skipIf(!hasPg)('Transactions', () => {
  it('begin → change → rollback leaves data untouched', async () => {
    await session.begin()
    expect((await session.txnStatus()).state).toBe('open')
    await session.execute("update users set name = 'TXN-DIRTY' where id = 1")
    await session.rollback()
    expect((await session.txnStatus()).state).toBe('none')

    const check = await session.execute('select name from users where id = 1')
    expect(check.page?.rows[0].name).not.toBe('TXN-DIRTY')
  })

  it('begin → change → commit persists data', async () => {
    const original = await session.execute('select name from users where id = 2')
    const originalName = original.page!.rows[0].name as string

    await session.begin()
    await session.execute("update users set name = 'TXN-COMMITTED' where id = 2")
    await session.commit()

    const check = await session.execute('select name from users where id = 2')
    expect(check.page!.rows[0].name).toBe('TXN-COMMITTED')

    await session.execute(
      `update users set name = '${originalName.replace(/'/g, "''")}' where id = 2`
    )
  })

  it('read-only connections open BEGIN READ ONLY and reject writes inside the txn', async () => {
    const ro = await connectSession({ id: 'it-ro2', accessMode: 'read-only' })
    try {
      await ro.begin()
      await expect(ro.execute("insert into users (name) values ('x')")).rejects.toMatchObject({
        sqlState: '25006'
      })
      await ro.commit()
    } finally {
      await ro.dispose()
    }
  })
})

describe.skipIf(!hasPg)('Export', () => {
  it('streams a CSV export with correct row count and content', async () => {
    const result = await session.execute('select id, name from users order by id', {
      pageSize: 100,
      sessionKey: 'export-csv'
    })
    const file = join(await mkdtemp(join(tmpdir(), 'dbforge-export-')), 'users.csv')
    const res = await session.exportResult({
      connectionId: session.connectionId,
      sessionId: result.sessionId!,
      format: 'csv',
      filePath: file
    })
    expect(res.rows).toBe(1200)
    expect(res.bytes).toBeGreaterThan(1000)

    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(lines[0]).toBe('id,name')
    expect(lines).toHaveLength(1201)
    expect(lines[1]).toMatch(/^1,user 1/)
    await session.closeSession(result.sessionId!)
  }, 20_000)

  it('streams JSON exports that parse back to the full row set', async () => {
    const result = await session.execute('select id, name from users order by id limit 25', {
      pageSize: 500,
      sessionKey: 'export-json'
    })
    const file = join(await mkdtemp(join(tmpdir(), 'dbforge-export-')), 'users.json')
    const res = await session.exportResult({
      connectionId: session.connectionId,
      sessionId: result.sessionId!,
      format: 'json',
      filePath: file
    })
    expect(res.rows).toBe(25)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown[]
    expect(parsed).toHaveLength(25)
    await session.closeSession(result.sessionId!)
  })
})

describe.skipIf(!hasPg)('Browse Table Data + EXPLAIN', () => {
  it('browses a table without writing SQL', async () => {
    const result = await session.browse({ schema: 'public', table: 'order_items' }, 50)
    expect(result.kind).toBe('SELECT')
    expect(result.page?.rows).toHaveLength(50)
    expect((result.columns ?? []).map((c) => c.name)).toContain('user_id')
    await session.closeSession(result.sessionId!)
  })

  it('returns EXPLAIN plan text', async () => {
    const plan = await session.explain('select count(*) from users', false)
    expect(plan.rows.join('\n')).toMatch(/Aggregate|Seq Scan|Index/)
  })

  it('runs EXPLAIN ANALYZE with real timing', async () => {
    const plan = await session.explain('select count(*) from users', true)
    expect(plan.rows.join('\n')).toMatch(/actual time/)
  })
})
