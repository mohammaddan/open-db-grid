// Auto-connect behavior: explorer/browse/execute/txn-begin must open the
// connection on demand; cancel/close/page must degrade gracefully when the
// connection is closed; concurrent connects must share one session.
//
// The driver registry is mocked so these run without a PostgreSQL server.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '@main/persistence/Store'
import { ConnectionService } from '@main/services/ConnectionService'
import { ExplorerService } from '@main/services/ExplorerService'
import { QueryService } from '@main/services/QueryService'
import { TransactionService } from '@main/services/TransactionService'
import { HistoryService } from '@main/services/HistoryService'
import { defaultAppData, type AppData } from '@main/services/AppData'
import type { CredentialStoreLike, PersistedSecrets, WrappedKey } from '@main/persistence/CredentialStore'
import type { DbConnection } from '@shared/models/connection'
import type { DriverSession } from '@main/database/DatabaseDriver'

// shared mock state (hoisted so the vi.mock factory can see it)
const mockState = vi.hoisted(() => ({
  connectCalls: [] as string[],
  failNext: false,
  probeFail: false
}))

function makeStubSession(): DriverSession {
  return {
    readOnly: false,
    probe: async () =>
      mockState.probeFail ? { ok: false } : { ok: true, serverVersion: '16.1' },
    explore: async () => [
      { id: 'databases', name: 'Databases', kind: 'group', hasChildren: true }
    ],
    execute: async (sql: string) => ({ kind: 'UTILITY', sql, durationMs: 1, message: 'OK' }),
    fetchPage: async () => {
      throw new Error('no cursor')
    },
    closeSession: async () => undefined,
    cancel: async () => ({ canceled: true }),
    explain: async () => ({ plan: 'Seq Scan' }),
    exportResult: async () => ({ path: '/tmp/x', rows: 0, bytes: 0, format: 'csv' }),
    saveEdits: async () => ({ applied: 0 }),
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    txnStatus: async () => ({ connectionId: 'stub', state: 'none' as const }),
    planForSelect: async () => {
      throw new Error('not planned')
    },
    browse: async () => ({ kind: 'UTILITY', sql: 'browse', durationMs: 1 }),
    dispose: async () => undefined
  } as unknown as DriverSession
}

vi.mock('@main/database/driverRegistry', () => ({
  driverRegistry: {
    forEngine: () => ({
      engine: 'postgresql',
      test: async () => ({ ok: true }),
      connect: async (opts: { connection: { id: string } }) => {
        mockState.connectCalls.push(opts.connection.id)
        if (mockState.failNext) {
          mockState.failNext = false
          throw new Error('password authentication failed for user "alice"')
        }
        return makeStubSession()
      }
    })
  }
}))

/** Deterministic in-memory credential store. */
class FakeCredentials implements CredentialStoreLike {
  readonly available = true
  readonly kindName = 'fake'
  private secrets = new Map<string, string>()
  loadPersisted(secrets: PersistedSecrets): void {
    for (const [id, blob] of Object.entries(secrets)) this.secrets.set(id, String(blob))
  }
  toPersisted(): PersistedSecrets {
    return {}
  }
  initKey(): WrappedKey | null {
    return null
  }
  async put(secret: string, id?: string): Promise<string> {
    const key = id ?? 'secret-' + (this.secrets.size + 1)
    this.secrets.set(key, secret)
    return key
  }
  async get(id: string): Promise<string | null> {
    return this.secrets.get(id) ?? null
  }
  async delete(id: string): Promise<void> {
    this.secrets.delete(id)
  }
  has(id: string): boolean {
    return this.secrets.has(id)
  }
}

function makeConnection(overrides: Partial<DbConnection> = {}): DbConnection {
  return {
    id: 'conn-' + Math.random().toString(36).slice(2, 8),
    name: 'Test PG',
    driver: 'postgresql',
    config: {
      host: 'localhost',
      port: 5432,
      database: 'app',
      username: 'alice',
      ssl: { mode: 'prefer' },
      connectTimeoutMs: 5000,
      poolSize: 4
    },
    accessMode: 'read-write',
    production: false,
    color: 'slate',
    tags: [],
    groupId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

let store: JsonStore<AppData>
let credentials: FakeCredentials
let connections: ConnectionService
let explorer: ExplorerService
let queries: QueryService
let txns: TransactionService
let connId: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbforge-auto-'))
  store = new JsonStore<AppData>(join(dir, 'app.json'), defaultAppData)
  await store.load()
  credentials = new FakeCredentials()
  connections = new ConnectionService(store, credentials)
  const history = new HistoryService(store, connections)
  explorer = new ExplorerService(connections)
  queries = new QueryService(connections, history)
  txns = new TransactionService(connections)
  mockState.connectCalls = []
  mockState.failNext = false
  mockState.probeFail = false

  const saved = await connections.save({ connection: makeConnection(), password: 'pw' })
  connId = saved.id
})

describe('on-demand connection opening', () => {
  it('explorer.children opens the connection automatically', async () => {
    const nodes = await explorer.children({ connectionId: connId, parentKey: null })
    expect(nodes).toHaveLength(1)
    expect(mockState.connectCalls).toEqual([connId])
    expect(connections.isOpen(connId)).toBe(true)
  })

  it('reuses the open session for subsequent calls (one connect total)', async () => {
    await explorer.children({ connectionId: connId, parentKey: null })
    await explorer.children({ connectionId: connId, parentKey: 'schemas' })
    await queries.execute({ connectionId: connId, sql: 'select 1' })
    expect(mockState.connectCalls).toEqual([connId])
  })

  it('query execution opens the connection on demand', async () => {
    const result = await queries.execute({ connectionId: connId, sql: 'select 1' })
    expect(result.kind).toBe('UTILITY')
    expect(mockState.connectCalls).toEqual([connId])
  })

  it('transaction begin opens the connection on demand', async () => {
    const res = await txns.begin(connId)
    expect(res.ok).toBe(true)
    expect(mockState.connectCalls).toEqual([connId])
  })

  it('browse table data opens the connection on demand', async () => {
    const res = await explorer.browse(connId, { schema: 'public', table: 'users' })
    expect(res.kind).toBe('UTILITY')
    expect(mockState.connectCalls).toEqual([connId])
  })
})

describe('connect race + failure handling', () => {
  it('concurrent connects share a single session', async () => {
    const results = await Promise.all([
      connections.connect(connId),
      connections.connect(connId),
      connections.connect(connId)
    ])
    for (const info of results) expect(info.connectionId).toBe(connId)
    expect(mockState.connectCalls).toEqual([connId])
  })

  it('a failed connect is retryable (no cached rejection)', async () => {
    mockState.failNext = true
    await expect(connections.connect(connId)).rejects.toThrow(/authentication failed/)
    expect(connections.isOpen(connId)).toBe(false)

    // retry succeeds — proves the in-flight entry was cleaned up
    const info = await connections.connect(connId)
    expect(info.connectionId).toBe(connId)
    expect(mockState.connectCalls).toEqual([connId, connId])
  })

  it('failed auto-open surfaces the real connect error', async () => {
    mockState.failNext = true
    await expect(
      explorer.children({ connectionId: connId, parentKey: null })
    ).rejects.toThrow(/authentication failed/)
    expect(connections.isOpen(connId)).toBe(false)
  })
})

describe('graceful behavior on closed connections', () => {
  it('cancel does not connect and reports nothing to cancel', async () => {
    const res = await queries.cancel(connId, 'sess-1')
    expect(res.canceled).toBe(false)
    expect(mockState.connectCalls).toEqual([])
  })

  it('closing a result session on a closed connection is a no-op', async () => {
    await expect(queries.close(connId, 'sess-1')).resolves.toBeUndefined()
    expect(mockState.connectCalls).toEqual([])
  })

  it('transaction status on a closed connection reports none', async () => {
    const status = await txns.status(connId)
    expect(status.state).toBe('none')
    expect(mockState.connectCalls).toEqual([])
  })

  it('commit on a closed connection returns a clean error, does not connect', async () => {
    const res = await txns.commit(connId)
    expect(res.ok).toBe(false)
    expect(res.error?.message).toMatch(/no transaction to commit/)
    expect(mockState.connectCalls).toEqual([])
  })

  it('paging on a closed connection explains that the cursor is gone', async () => {
    await expect(queries.page(connId, 'sess-1')).rejects.toThrow(/re-run the query/)
    expect(mockState.connectCalls).toEqual([])
  })
})


