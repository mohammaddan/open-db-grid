// Connection sidebar: hierarchical groups, drag & drop, search, context menus.
// Colors, tags, production markers and read-only badges are always visible.

import { useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent
} from '@dnd-kit/core'
import { Plus, Search } from 'lucide-react'
import type { ConnectionGroup, DbConnection } from '@shared/models/connection'
import { colorOf } from '@shared/models/connection'
import { useConnectionsStore } from '@renderer/state/connections'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { GroupRow } from './GroupRow'
import { ConnectionRow } from './ConnectionRow'
import { useContextMenu, ContextMenuView, type ContextMenuItem } from './ContextMenu'

interface TreeGroup {
  group: ConnectionGroup
  children: TreeGroup[]
  connections: DbConnection[]
}

function buildTree(groups: ConnectionGroup[], connections: DbConnection[]): TreeGroup[] {
  const byParent = new Map<string | null, ConnectionGroup[]>()
  for (const g of groups) {
    const list = byParent.get(g.parentId) ?? []
    list.push(g)
    byParent.set(g.parentId, list)
  }
  const connsByGroup = new Map<string | null, DbConnection[]>()
  for (const c of connections) {
    const list = connsByGroup.get(c.groupId) ?? []
    list.push(c)
    connsByGroup.set(c.groupId, list)
  }
  const sortConns = (a: DbConnection, b: DbConnection): number =>
    (a.order ?? 1e9) - (b.order ?? 1e9) || a.name.localeCompare(b.name)

  const build = (parentId: string | null): TreeGroup[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((g) => ({
        group: g,
        children: build(g.id),
        connections: (connsByGroup.get(g.id) ?? []).sort(sortConns)
      }))
  return build(null)
}

/** Filtered subtree, or null when neither the node nor any descendant matches. */
function filterTree(node: TreeGroup, f: string): TreeGroup | null {
  if (f === '') return node
  const conns = node.connections.filter(
    (c) =>
      c.name.toLowerCase().includes(f) ||
      c.config.host.toLowerCase().includes(f) ||
      c.config.database.toLowerCase().includes(f) ||
      c.tags.some((t) => t.toLowerCase().includes(f))
  )
  const kids = node.children
    .map((ch) => filterTree(ch, f))
    .filter((ch): ch is TreeGroup => ch !== null)
  const hit =
    node.group.name.toLowerCase().includes(f) || conns.length > 0 || kids.length > 0
  if (!hit) return null
  return { group: node.group, children: kids, connections: conns }
}

function isDescendant(groups: ConnectionGroup[], ancestorId: string, candidateId: string): boolean {
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]))
  let cur = parentOf.get(candidateId) ?? null
  while (cur !== null) {
    if (cur === ancestorId) return true
    cur = parentOf.get(cur) ?? null
  }
  return false
}

export function ConnectionSidebar(): JSX.Element {
  const { menu, open, close } = useContextMenu()
  const [filter, setFilterText] = useState('')
  const connections = useConnectionsStore((s) => s.connections)
  const groups = useConnectionsStore((s) => s.groups)
  const openInfo = useConnectionsStore((s) => s.openInfo)
  const selectedId = useConnectionsStore((s) => s.selectedId)
  const expandedGroups = useConnectionsStore((s) => s.expandedGroups)
  const store = useConnectionsStore.getState()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const tree = useMemo(() => buildTree(groups, connections), [groups, connections])
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (f === '') return tree
    return tree.map((t) => filterTree(t, f)).filter((t): t is TreeGroup => t !== null)
  }, [tree, filter])

  const isOpen = (id: string): boolean => Boolean(openInfo[id])

  const onDragEnd = (event: DragEndEvent): void => {
    const activeData = event.active.data.current as
      | { kind: 'connection' | 'group'; groupId: string | null }
      | undefined
    const overData = event.over?.data.current as
      | { kind: 'group-drop' | 'connection-drop'; groupId: string | null }
      | undefined
    if (!activeData || !overData) return
    const targetGroupId = overData.groupId
    if (activeData.kind === 'connection') {
      const conn = connections.find((c) => c.id === event.active.id)
      if (!conn || conn.groupId === targetGroupId) return
      void store.moveConnection(conn.id, targetGroupId)
    } else {
      const gid = String(event.active.id)
      if (gid === targetGroupId) return
      if (targetGroupId !== null && isDescendant(groups, gid, targetGroupId)) return
      const siblings = groups.filter((g) => g.parentId === targetGroupId && g.id !== gid)
      void store.moveGroup(gid, targetGroupId, siblings.length)
    }
  }

  const groupMenu = (g: ConnectionGroup): ContextMenuItem[] => [
    { label: 'New Connection…', action: () => useUiStore.getState().openConnectionDialog(null) },
    { label: 'New Group…', action: () => void promptGroup('New group', g.id) },
    { label: 'Rename…', action: () => void promptRename(g) },
    {
      separatorBefore: true,
      label: 'Delete group',
      danger: true,
      action: () => void deleteGroupDeep(g)
    }
  ]

  const connMenu = (c: DbConnection): ContextMenuItem[] => {
    const connected = isOpen(c.id)
    const items: ContextMenuItem[] = connected
      ? [{ label: 'Disconnect', action: () => void store.disconnect(c.id) }]
      : [{ label: 'Connect', action: () => void store.connect(c.id) }]
    items.push(
      {
        label: 'New Query',
        action: () => void useEditorStore.getState().newQueryTab(c.id, '')
      },
      {
        separatorBefore: true,
        label: 'Edit Connection…',
        action: () => useUiStore.getState().openConnectionDialog(c.id)
      },
      { label: 'Duplicate', action: () => void store.duplicateConnection(c.id) },
      { label: 'Rename…', action: () => void promptConnRename(c) },
      {
        separatorBefore: true,
        label: 'Delete Connection',
        danger: true,
        action: () =>
          useUiStore.getState().requestConfirm({
            title: 'Delete connection?',
            message: `Delete "${c.name}"? Saved credentials for it are removed too.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => void store.removeConnection(c.id)
          })
      }
    )
    return items
  }

  const rootMenu = (): ContextMenuItem[] => [
    { label: 'New Connection…', action: () => useUiStore.getState().openConnectionDialog(null) },
    { label: 'New Group…', action: () => void promptGroup('New group', null) },
    { separatorBefore: true, label: 'Collapse All', action: collapseAll }
  ]

  function collapseAll(): void {
    for (const g of groups) store.setExpanded(g.id, false)
  }

  async function promptRename(g: ConnectionGroup): Promise<void> {
    const name = window.prompt('Rename group', g.name)
    if (name && name.trim()) await store.renameGroup(g.id, name.trim())
  }

  async function promptConnRename(c: DbConnection): Promise<void> {
    const name = window.prompt('Rename connection', c.name)
    if (name && name.trim()) await store.renameConnection(c.id, name.trim())
  }

  async function promptGroup(title: string, parentId: string | null): Promise<void> {
    const name = window.prompt(title, '')
    if (name && name.trim()) {
      await store.addGroup(name.trim(), parentId)
      if (parentId) store.setExpanded(parentId, true)
    }
  }

  /** Reparents children to the deleted group's parent, then removes it. */
  async function deleteGroupDeep(g: ConnectionGroup): Promise<void> {
    const childGroups = groups.filter((x) => x.parentId === g.id)
    const childConns = connections.filter((c) => c.groupId === g.id)
    for (const cg of childGroups) await store.moveGroup(cg.id, g.parentId, cg.order)
    for (const cc of childConns) await store.moveConnection(cc.id, g.parentId)
    await store.deleteGroup(g.id)
  }

  const renderGroup = (node: TreeGroup, depth: number): JSX.Element[] => {
    const expanded = expandedGroups.has(node.group.id)
    const rows: JSX.Element[] = [
      <GroupRow
        key={'g:' + node.group.id}
        group={node.group}
        depth={depth}
        expanded={expanded}
        onToggle={() => store.setExpanded(node.group.id, !expanded)}
        onContextMenu={(e) => open(e, groupMenu(node.group))}
      />
    ]
    if (expanded) {
      for (const child of node.children) rows.push(...renderGroup(child, depth + 1))
      for (const conn of node.connections) {
        rows.push(
          <ConnectionRow
            key={'c:' + conn.id}
            connection={conn}
            depth={depth + 1}
            connected={isOpen(conn.id)}
            selected={selectedId === conn.id}
            color={colorOf(conn.color)}
            onSelect={() => store.select(conn.id)}
            onDoubleClick={() => {
              if (!isOpen(conn.id)) void store.connect(conn.id)
            }}
            onContextMenu={(e) => open(e, connMenu(conn))}
          />
        )
      }
    }
    return rows
  }

  return (
    <div className="sidebar">
      <div className="sidebar-search">
        <Search size={13} className="icon" />
        <input
          placeholder="Search connections, tags…"
          value={filter}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>
      <div className="sidebar-toolbar">
        <button
          className="btn ghost"
          title="New Connection (Ctrl+Shift+N)"
          onClick={() => useUiStore.getState().openConnectionDialog(null)}
        >
          <Plus size={13} /> Connection
        </button>
        <button
          className="btn ghost"
          title="New group"
          onClick={() => void promptGroup('New group', null)}
        >
          <Plus size={13} /> Group
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="tree">
          <GroupRow
            group={{ id: '__root__', name: 'Databases', parentId: null, collapsed: false, order: 0 }}
            depth={0}
            expanded
            onToggle={() => undefined}
            onContextMenu={(e) => open(e, rootMenu())}
            root
          />
          {filtered.map((node) => renderGroup(node, 1))}
        </div>
      </DndContext>
      {menu && <ContextMenuView menu={menu} onClose={close} />}
    </div>
  )
}
