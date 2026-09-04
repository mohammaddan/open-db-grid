// Service-level persistence tests: ConnectionService (groups, secrets, recents,
// duplicate, delete cascades), HistoryService (bounded, per-connection) and
// SavedQueriesService — all against a real JsonStore on disk.

import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '@main/persistence/Store'
import { ConnectionService } from '@main/services/ConnectionService'
import { HistoryService, SavedQueriesService } from '@main/services/HistoryService'
import { defaultAppData, type AppData } from '@main/services/AppData'
import type { CredentialStoreLike, PersistedSecrets, WrappedKey } from '@main/persistence/CredentialStore'
import type { DbConnection } from '@shared/models/connection'

/** Deterministic in-memory credential store (secret id -> secret). */
class FakeCredentials implements CredentialStoreLike {
  readonly available = true
  readonly kindName = 'fake'
  private secrets = new Map<string, string>()
  loadPersisted(secrets: PersistedSecrets): void {
    for (const [id, blob] of Object.entries(secrets)) this.secrets.set(id, String(blob))
  }
  toPersisted(): PersistedSecrets {
    // memory-only store: nothing is ever written to disk
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

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbforge-svc-'))
  store = new JsonStore<AppData>(join(dir, 'app.json'), defaultAppData)
  await store.load()
  credentials = new FakeCredentials()
  connections = new ConnectionService(store, credentials)
})

describe('ConnectionService', () => {
  it('saves a connection with its secret, never plaintext', async () => {
    const saved = await connections.save({
      connection: makeConnection({ id: 'c1' }),
      password: 'hunter2'
    })
    expect(saved.secretId).toBeTruthy()
    expect(await credentials.get(saved.secretId!)).toBe('hunter2')

    const raw = JSON.stringify(store.data)
    expect(raw).not.toContain('hunter2')
  })

  it('keeps the secret id when saving without a new password', async () => {
    const first = await connections.save({ connection: makeConnection({ id: 'c1' }), password: 'a' })
    const again = await connections.save({ connection: { ...first, name: 'Renamed' } })
    expect(again.secretId).toBe(first.secretId)
    expect(await credentials.get(first.secretId!)).toBe('a')
    expect(connections.get('c1')?.name).toBe('Renamed')
  })

  it('removes the secret and recents when a connection is deleted', async () => {
    const saved = await connections.save({ connection: makeConnection({ id: 'c1' }), password: 's3cret' })
    await connections.touch('c1')
    expect(connections.recents()).toHaveLength(1)

    await connections.remove('c1')
    expect(credentials.has(saved.secretId!)).toBe(false)
    expect(connections.list()).toHaveLength(0)
    expect(connections.recents()).toHaveLength(0)
  })

  it('duplicates a connection with a fresh secret id', async () => {
    const saved = await connections.save({ connection: makeConnection({ id: 'c1' }), password: 'dup' })
    const copy = await connections.duplicate('c1')
    expect(copy.id).not.toBe('c1')
    expect(copy.name).toContain('(copy)')
    expect(copy.secretId).not.toBe(saved.secretId)
    expect(await credentials.get(copy.secretId!)).toBe('dup')
  })

  it('creates, renames, moves and deletes groups', async () => {
    await connections.saveGroup({ id: 'g1', name: 'Production', parentId: null, collapsed: false, order: 0 })
    await connections.saveGroup({ id: 'g2', name: 'EU', parentId: 'g1', collapsed: false, order: 0 })

    await connections.save({ connection: makeConnection({ id: 'c1', groupId: null }) })
    await connections.moveConnection('c1', 'g1', 0)
    expect(connections.get('c1')?.groupId).toBe('g1')

    await connections.moveGroup('g2', null, 1)
    expect(connections.listGroups().find((g) => g.id === 'g2')?.parentId).toBeNull()

    // rename = saveGroup with an updated name (the renderer does the same)
    const g1 = connections.listGroups().find((g) => g.id === 'g1')!
    await connections.saveGroup({ ...g1, name: 'Prod v2' })
    expect(connections.listGroups().find((g) => g.id === 'g1')?.name).toBe('Prod v2')

    await connections.removeGroup('g1')
    // g2 was re-parented to the root earlier, so it survives the delete
    const remaining = connections.listGroups()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('g2')
  })

  it('bounds the recents list and puts the most recent first', async () => {
    for (let i = 0; i < 15; i++) {
      await connections.save({ connection: makeConnection({ id: 'c' + i }) })
      await connections.touch('c' + i)
    }
    const recents = connections.recents()
    expect(recents.length).toBeLessThanOrEqual(12)
    expect(recents[0].connectionId).toBe('c14')
  })
})

describe('HistoryService', () => {
  let history: HistoryService

  beforeEach(async () => {
    await connections.save({ connection: makeConnection({ id: 'c1', name: 'Main PG' }) })
    history = new HistoryService(store, connections)
  })

  it('records entries per connection and resolves the connection name', async () => {
    await history.add({ connectionId: 'c1', sql: 'select 1', success: true, kind: 'SELECT', durationMs: 3, resultCount: 1 })
    const list = history.list('c1')
    expect(list).toHaveLength(1)
    expect(list[0].connectionName).toBe('Main PG')
    expect(list[0].sql).toBe('select 1')
    expect(list[0].success).toBe(true)
  })

  it('stores no credentials in history entries', async () => {
    await history.add({
      connectionId: 'c1',
      sql: "select * from users where password = 'hunter2'",
      success: false,
      kind: 'SELECT'
    })
    const list = history.list('c1')
    expect(list[0]).not.toHaveProperty('password')
    expect(JSON.stringify(list[0])).not.toContain('secretId')
  })

  it('is bounded per connection', async () => {
    for (let i = 0; i < 30; i++) {
      await history.add({ connectionId: 'c1', sql: `select ${i}`, success: true, kind: 'SELECT' })
    }
    expect(history.list('c1').length).toBeLessThanOrEqual(500)
    expect(history.list('c1')[0].sql).toBe('select 29')
  })

  it('filters by connection and supports remove/clear', async () => {
    await connections.save({ connection: makeConnection({ id: 'c2', name: 'Other' }) })
    await history.add({ connectionId: 'c1', sql: 'select 1', success: true, kind: 'SELECT' })
    await history.add({ connectionId: 'c2', sql: 'select 2', success: true, kind: 'SELECT' })

    expect(history.list('c1')).toHaveLength(1)
    expect(history.list()).toHaveLength(2)

    const first = history.list()[0]
    await history.remove(first.id)
    expect(history.list()).toHaveLength(1)

    await history.clear('c2')
    expect(history.list('c2')).toHaveLength(0)
    expect(history.list('c1')).toHaveLength(1)
  })
})

describe('SavedQueriesService', () => {
  it('saves, dedupes by name+connection, and removes', async () => {
    const saved = new SavedQueriesService(store)
    await saved.save({ name: 'Active users', sql: 'select 1', connectionId: 'c1' })
    await saved.save({ name: 'active USERS', sql: 'select 2', connectionId: 'c1' })

    expect(saved.list()).toHaveLength(1)
    expect(saved.list()[0].sql).toBe('select 2')

    await saved.remove(saved.list()[0].id)
    expect(saved.list()).toHaveLength(0)
  })
})
