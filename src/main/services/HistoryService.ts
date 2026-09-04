// HistoryService: query history per connection, bounded, searchable.
// Credentials never enter history — only the SQL text (which contains no
// connection secrets).

import { randomUUID } from 'node:crypto'
import type { JsonStore } from '@main/persistence/Store'
import type { HistoryEntry, SavedQuery } from '@shared/models/history'
import { HISTORY_PER_CONNECTION_LIMIT } from './AppData'
import type { AppData } from './AppData'
import { ConnectionService } from './ConnectionService'

export class HistoryService {
  /** guarantees strictly increasing executedAt even within the same millisecond */
  private lastTimestamp = 0

  constructor(
    private readonly store: JsonStore<AppData>,
    private readonly connections: ConnectionService
  ) {}

  async add(entry: Omit<HistoryEntry, 'id' | 'executedAt' | 'connectionName'>): Promise<HistoryEntry> {
    const now = Date.now()
    const executedAt = now > this.lastTimestamp ? now : this.lastTimestamp + 1
    this.lastTimestamp = executedAt
    const full: HistoryEntry = {
      ...entry,
      id: randomUUID(),
      executedAt,
      connectionName: this.connections.connectionName(entry.connectionId)
    }
    const data = this.store.data
    const list = data.history[full.connectionId] ?? []
    list.unshift(full)
    if (list.length > HISTORY_PER_CONNECTION_LIMIT) list.length = HISTORY_PER_CONNECTION_LIMIT
    data.history[full.connectionId] = list
    await this.store.save()
    return full
  }

  list(connectionId?: string): HistoryEntry[] {
    const data = this.store.data
    if (connectionId) {
      return (data.history[connectionId] ?? []).slice()
    }
    return Object.values(data.history)
      .flat()
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, HISTORY_PER_CONNECTION_LIMIT)
  }

  async remove(id: string): Promise<void> {
    const data = this.store.data
    for (const key of Object.keys(data.history)) {
      data.history[key] = data.history[key].filter((h) => h.id !== id)
    }
    await this.store.save()
  }

  async clear(connectionId?: string): Promise<void> {
    const data = this.store.data
    if (connectionId) delete data.history[connectionId]
    else data.history = {}
    await this.store.save()
  }
}

export class SavedQueriesService {
  constructor(private readonly store: JsonStore<AppData>) {}

  list(): SavedQuery[] {
    return [...this.store.data.savedQueries].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async save(q: Pick<SavedQuery, 'name' | 'sql' | 'connectionId'>): Promise<SavedQuery> {
    const now = Date.now()
    const existing = this.store.data.savedQueries.find(
      (s) => s.name.toLowerCase() === q.name.toLowerCase() && s.connectionId === q.connectionId
    )
    const saved: SavedQuery = existing
      ? { ...existing, sql: q.sql, connectionId: q.connectionId, updatedAt: now }
      : { ...q, id: randomUUID(), createdAt: now, updatedAt: now }
    const data = this.store.data
    const idx = data.savedQueries.findIndex((s) => s.id === saved.id)
    if (idx >= 0) data.savedQueries[idx] = saved
    else data.savedQueries.push(saved)
    await this.store.save()
    return saved
  }

  async remove(id: string): Promise<void> {
    this.store.data.savedQueries = this.store.data.savedQueries.filter((s) => s.id !== id)
    await this.store.save()
  }
}