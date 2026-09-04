// ConnectionService: CRUD for connections + groups, open-session lifecycle,
// secure secret handling, recents. Session handles stay in main — the renderer
// only ever sees OpenConnectionInfo (no passwords, no pg objects).

import { randomUUID } from 'node:crypto'
import type { JsonStore } from '@main/persistence/Store'
import type { CredentialStoreLike } from '@main/persistence/CredentialStore'
import type {
  DbConnection,
  ConnectionGroup,
  ConnectionSaveRequest,
  ConnectionTestRequest,
  ConnectionTestResult,
  OpenConnectionInfo
} from '@shared/models/connection'
import type { DriverSession } from '@main/database/DatabaseDriver'
import { driverRegistry } from '@main/database/driverRegistry'
import { DatabaseError, toQueryErrorInfo } from '@main/database/errors'
import type { AppData } from './AppData'

export class ConnectionService {
  private sessions = new Map<string, { session: DriverSession; info: OpenConnectionInfo }>()

  constructor(
    private readonly store: JsonStore<AppData>,
    private readonly credentials: CredentialStoreLike
  ) {}

  // -- data access ---------------------------------------------------------

  list(): DbConnection[] {
    return [...this.store.data.connections].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): DbConnection | undefined {
    return this.store.data.connections.find((c) => c.id === id)
  }

  listGroups(): ConnectionGroup[] {
    return [...this.store.data.groups].sort((a, b) => a.order - b.order)
  }

  // -- persistence ---------------------------------------------------------

  async save(req: ConnectionSaveRequest): Promise<DbConnection> {
    const data = this.store.data
    const existing = data.connections.find((c) => c.id === req.connection.id)
    let connection: DbConnection

    if (req.password !== undefined && req.password !== '') {
      const secretId = existing?.secretId
      const newSecretId = await this.credentials.put(req.password, secretId)
      connection = { ...req.connection, secretId: newSecretId, updatedAt: Date.now() }
    } else if (existing?.secretId) {
      connection = { ...req.connection, secretId: existing.secretId, updatedAt: Date.now() }
    } else {
      connection = { ...req.connection, updatedAt: Date.now() }
    }

    const idx = data.connections.findIndex((c) => c.id === connection.id)
    if (idx >= 0) data.connections[idx] = connection
    else data.connections.push(connection)
    await this.store.save()
    return connection
  }

  async remove(id: string): Promise<void> {
    const data = this.store.data
    const conn = data.connections.find((c) => c.id === id)
    if (conn) {
      await this.closeSession(id).catch(() => undefined)
      if (conn.secretId) await this.credentials.delete(conn.secretId)
      data.connections = data.connections.filter((c) => c.id !== id)
      data.recents = data.recents.filter((r) => r.connectionId !== id)
      delete data.history[id]
    }
    await this.store.save()
  }

  async duplicate(id: string): Promise<DbConnection> {
    const source = this.get(id)
    if (!source) throw new DatabaseError({ message: 'Connection not found.' })
    const copy: DbConnection = {
      ...source,
      id: randomUUID(),
      name: `${source.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: undefined
    }
    if (source.secretId) {
      const secret = await this.credentials.get(source.secretId)
      if (secret !== null) copy.secretId = await this.credentials.put(secret)
    }
    this.store.data.connections.push(copy)
    await this.store.save()
    return copy
  }

  // -- groups --------------------------------------------------------------

  async saveGroup(g: ConnectionGroup): Promise<ConnectionGroup> {
    const data = this.store.data
    const idx = data.groups.findIndex((x) => x.id === g.id)
    if (idx >= 0) data.groups[idx] = g
    else data.groups.push(g)
    await this.store.save()
    return g
  }

  async removeGroup(id: string): Promise<void> {
    const data = this.store.data
    const group = data.groups.find((g) => g.id === id)
    const parentId = group?.parentId ?? null
    for (const child of data.groups) {
      if (child.parentId === id) child.parentId = parentId
    }
    for (const c of data.connections) {
      if (c.groupId === id) c.groupId = parentId
    }
    data.groups = data.groups.filter((g) => g.id !== id)
    await this.store.save()
  }

  async moveGroup(id: string, newParentId: string | null, order: number): Promise<void> {
    const data = this.store.data
    if (newParentId === id) return
    const group = data.groups.find((g) => g.id === id)
    if (!group) return
    const isDescendant = (candidate: string | null): boolean => {
      if (!candidate) return false
      if (candidate === id) return true
      const parent = data.groups.find((g) => g.id === candidate)
      return parent ? isDescendant(parent.parentId) : false
    }
    if (isDescendant(newParentId)) return
    group.parentId = newParentId
    group.order = order
    await this.store.save()
  }

  async moveConnection(connectionId: string, groupId: string | null, order: number): Promise<void> {
    const conn = this.get(connectionId)
    if (!conn) return
    conn.groupId = groupId
    conn.order = order
    await this.store.save()
  }

  // -- connect / disconnect -------------------------------------------------

  async connect(id: string): Promise<OpenConnectionInfo> {
    const existing = this.sessions.get(id)
    if (existing) return existing.info

    const conn = this.get(id)
    if (!conn) throw new DatabaseError({ message: 'Connection not found.' })

    const factory = driverRegistry.forEngine(conn.driver)
    const session = await factory.connect({
      connection: conn,
      secretProvider: async () => (conn.secretId ? this.credentials.get(conn.secretId) : null)
    })

    const info: OpenConnectionInfo = {
      connectionId: conn.id,
      engine: conn.driver,
      serverVersion: undefined,
      connectedAt: Date.now(),
      readOnly: conn.accessMode === 'read-only'
    }
    try {
      const probe = await session.probe()
      info.serverVersion = probe.serverVersion
    } catch {
      /* informational */
    }
    this.sessions.set(id, { session, info })
    await this.touch(id)
    return info
  }

  async disconnect(id: string): Promise<void> {
    await this.closeSession(id)
  }

  listOpen(): OpenConnectionInfo[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  getSession(id: string): DriverSession {
    const entry = this.sessions.get(id)
    if (!entry) {
      throw new DatabaseError({
        message: `Connection "${id}" is not open. Open it from the sidebar first.`,
        code: 'EFORGE_NOT_CONNECTED'
      })
    }
    return entry.session
  }

  isOpen(id: string): boolean {
    return this.sessions.has(id)
  }

  private async closeSession(id: string): Promise<void> {
    const entry = this.sessions.get(id)
    if (!entry) return
    this.sessions.delete(id)
    await entry.session.dispose()
  }

  async touch(id: string): Promise<void> {
    const conn = this.get(id)
    if (!conn) return
    conn.lastUsedAt = Date.now()
    const data = this.store.data
    data.recents = data.recents.filter((r) => r.connectionId !== id)
    data.recents.unshift({ connectionId: id, lastUsedAt: Date.now() })
    data.recents = data.recents.slice(0, 12)
    await this.store.save()
  }

  recents(): Array<{ connectionId: string; lastUsedAt: number }> {
    return this.store.data.recents
  }

  async test(req: ConnectionTestRequest): Promise<ConnectionTestResult> {
    const password =
      (req.check.secretId && (await this.credentials.get(req.check.secretId))) ??
      req.password ??
      null
    const factory = driverRegistry.forEngine(req.check.driver)
    try {
      return await factory.test({
        connection: req.check,
        secretProvider: async () => password
      })
    } catch (err) {
      return { ok: false, error: toQueryErrorInfo(err) }
    }
  }

  /** sweep driver sessions held for long-idle cursor results */
  async sweepIdleCursors(maxIdleMs: number): Promise<number> {
    let closed = 0
    for (const entry of this.sessions.values()) {
      try {
        const sweepable = entry.session as DriverSession & {
          sweepExpiredSessions?: (ms: number) => Promise<string[]>
        }
        if (sweepable.sweepExpiredSessions) {
          closed += (await sweepable.sweepExpiredSessions(maxIdleMs)).length
        }
      } catch {
        /* ignore */
      }
    }
    return closed
  }

  connectionName(id: string): string {
    return this.get(id)?.name ?? id
  }
}