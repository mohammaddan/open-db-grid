import { create } from 'zustand'
import type {
  DbConnection,
  ConnectionGroup,
  ConnectionTestResult,
  OpenConnectionInfo
} from '@shared/models/connection'
import { useUiStore } from './ui'
import { extractApiError } from '@renderer/lib/api'

interface ConnectionsState {
  connections: DbConnection[]
  groups: ConnectionGroup[]
  openInfo: Record<string, OpenConnectionInfo>
  selectedId: string | null
  filter: string
  expandedGroups: Set<string>

  init: () => Promise<void>
  saveConnection: (
    conn: DbConnection,
    password?: string
  ) => Promise<DbConnection | null>
  testConnection: (conn: DbConnection, password?: string) => Promise<ConnectionTestResult>
  removeConnection: (id: string) => Promise<void>
  duplicateConnection: (id: string) => Promise<void>
  connect: (id: string) => Promise<boolean>
  disconnect: (id: string) => Promise<void>
  select: (id: string | null) => void
  setFilter: (f: string) => void
  setExpanded: (groupId: string, expanded: boolean) => void
  addGroup: (name: string, parentId: string | null) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  moveGroup: (id: string, newParentId: string | null, order: number) => Promise<void>
  moveConnection: (connectionId: string, groupId: string | null, order?: number) => Promise<void>
  renameConnection: (id: string, name: string) => Promise<void>
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  groups: [],
  openInfo: {},
  selectedId: null,
  filter: '',
  expandedGroups: new Set<string>(),

  async init() {
    try {
      const [connections, groups, open] = await Promise.all([
        window.api.connections.list(),
        window.api.groups.list(),
        window.api.connections.listOpen()
      ])
      set({
        connections,
        groups,
        openInfo: Object.fromEntries(open.map((o) => [o.connectionId, o]))
      })
    } catch {
      useUiStore.getState().pushToast('error', 'Failed to load connections.')
    }
  },

  async saveConnection(conn, password) {
    try {
      const saved = await window.api.connections.save({
        connection: conn,
        password: password ?? undefined
      })
      const list = get().connections.filter((c) => c.id !== saved.id)
      set({ connections: [...list, saved] })
      return saved
    } catch (err) {
      useUiStore.getState().pushToast('error', extractApiError(err).message)
      return null
    }
  },

  async testConnection(conn, password) {
    return window.api.connections.test({ check: conn, password: password ?? undefined })
  },

  async removeConnection(id) {
    await window.api.connections.remove(id)
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      openInfo: { ...s.openInfo },
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
    delete get().openInfo[id]
    set({ openInfo: { ...get().openInfo } })
  },

  async duplicateConnection(id) {
    const copy = await window.api.connections.duplicate(id)
    set((s) => ({ connections: [...s.connections, copy] }))
  },

  async connect(id) {
    try {
      const info = await window.api.connections.connect(id)
      set((s) => ({
        openInfo: { ...s.openInfo, [id]: info },
        selectedId: id
      }))
      return true
    } catch (err) {
      useUiStore.getState().pushToast('error', extractApiError(err).message)
      return false
    }
  },

  async disconnect(id) {
    await window.api.connections.disconnect(id)
    const info = { ...get().openInfo }
    delete info[id]
    set({ openInfo: info })
  },

  select(id) {
    set({ selectedId: id })
  },

  setFilter(f) {
    set({ filter: f })
  },

  setExpanded(groupId, expanded) {
    const next = new Set(get().expandedGroups)
    if (expanded) next.add(groupId)
    else next.delete(groupId)
    set({ expandedGroups: next })
  },

  async addGroup(name, parentId) {
    const id = crypto.randomUUID()
    const group: ConnectionGroup = { id, name, parentId, collapsed: false, order: get().groups.length }
    await window.api.groups.save(group)
    set((s) => ({ groups: [...s.groups, group] }))
  },

  async renameGroup(id, name) {
    const group = get().groups.find((g) => g.id === id)
    if (!group) return
    const updated = { ...group, name }
    await window.api.groups.save(updated)
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? updated : g)) }))
  },

  async deleteGroup(id) {
    await window.api.groups.remove(id)
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }))
  },

  async moveGroup(id, newParentId, order) {
    await window.api.groups.move(id, newParentId, order)
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, parentId: newParentId, order } : g))
    }))
  },

  async moveConnection(connectionId, groupId, order) {
    const conn = get().connections.find((c) => c.id === connectionId)
    if (!conn) return
    // persist via save (keeps secretId)
    await get().saveConnection({ ...conn, groupId, order: order ?? conn.order ?? 0 })
  },

  async renameConnection(id, name) {
    const conn = get().connections.find((c) => c.id === id)
    if (!conn) return
    await get().saveConnection({ ...conn, name })
  }
}))