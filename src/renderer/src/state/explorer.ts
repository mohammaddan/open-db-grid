import { create } from 'zustand'
import type { ExplorerNode } from '@shared/models/explorer'
import { extractApiError } from '@renderer/lib/api'
import { useUiStore } from './ui'

interface ExplorerState {
  activeConnectionId: string | null
  /** `${connId}:${parentKey}` -> children (undefined = not loaded) */
  childrenByKey: Record<string, ExplorerNode[]>
  failedKeys: Record<string, string>
  /** connId -> set of expanded node keys */
  expandedByConn: Record<string, Set<string>>,
  loadingKey: string | null

  setActiveConnection: (connId: string | null) => void
  isExpanded: (connId: string, key: string) => boolean
  toggle: (connId: string, node: ExplorerNode) => Promise<void>
  expand: (connId: string, key: string) => Promise<void>
  loadChildren: (connId: string, parentKey: string, forceRefresh?: boolean) => Promise<ExplorerNode[]>
  refresh: (connId: string, parentKey?: string) => Promise<void>
  clearForConnection: (connId: string) => void
}

function cacheKey(connId: string, parentKey: string): string {
  return connId + ':' + parentKey
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  activeConnectionId: null,
  childrenByKey: {},
  failedKeys: {},
  expandedByConn: {},
  loadingKey: null,

  setActiveConnection(connId) {
    set({ activeConnectionId: connId })
    if (connId && !get().childrenByKey[cacheKey(connId, '')]) {
      void get().loadChildren(connId, '', false)
    }
  },

  isExpanded(connId, key) {
    return get().expandedByConn[connId]?.has(key) ?? false
  },

  async toggle(connId, node) {
    const current = get().isExpanded(connId, node.key)
    const expanded = new Set(get().expandedByConn[connId] ?? [])
    if (current) {
      expanded.delete(node.key)
      set({ expandedByConn: { ...get().expandedByConn, [connId]: expanded } })
    } else {
      expanded.add(node.key)
      set({ expandedByConn: { ...get().expandedByConn, [connId]: expanded } })
      if (!get().childrenByKey[cacheKey(connId, node.key)]) {
        await get().loadChildren(connId, node.key, false)
      }
    }
  },

  async expand(connId, key) {
    const expanded = new Set(get().expandedByConn[connId] ?? [])
    expanded.add(key)
    set({ expandedByConn: { ...get().expandedByConn, [connId]: expanded } })
    if (!get().childrenByKey[cacheKey(connId, key)]) {
      await get().loadChildren(connId, key, false)
    }
  },

  async loadChildren(connId, parentKey, forceRefresh = false) {
    const key = cacheKey(connId, parentKey)
    const cached = get().childrenByKey[key]
    if (cached && cached.length > 0 && !forceRefresh) return cached
    if (get().loadingKey === key && !forceRefresh) return cached ?? []
    set({ loadingKey: key })
    try {
      const children = await window.api.explorer.children({
        connectionId: connId,
        parentKey: parentKey === '' ? null : parentKey,
        forceRefresh
      })
      set((s) => ({
        childrenByKey: { ...s.childrenByKey, [key]: children },
        loadingKey: null,
        failedKeys: { ...s.failedKeys, [key]: '' }
      }))
      return children
    } catch (err) {
      set((s) => ({
        loadingKey: null,
        failedKeys: { ...s.failedKeys, [key]: extractApiError(err).message }
      }))
      useUiStore.getState().pushToast('error', 'Explore failed: ' + extractApiError(err).message)
      return cached ?? []
    }
  },

  async refresh(connId, parentKey) {
    // refresh the whole tree root as well as the requested branch
    await get().loadChildren(connId, parentKey ?? '', true)
    if (parentKey) await get().loadChildren(connId, '', true)
  },

  clearForConnection(connId) {
    const childrenByKey = { ...get().childrenByKey }
    const failedKeys = { ...get().failedKeys }
    const expandedByConn = { ...get().expandedByConn }
    for (const k of Object.keys(childrenByKey)) {
      if (k.startsWith(connId + ':')) delete childrenByKey[k]
    }
    for (const k of Object.keys(failedKeys)) {
      if (k.startsWith(connId + ':')) delete failedKeys[k]
    }
    delete expandedByConn[connId]
    set({
      childrenByKey,
      failedKeys,
      expandedByConn,
      activeConnectionId:
        get().activeConnectionId === connId ? null : get().activeConnectionId
    })
  }
}))