// Lazy database explorer. Nodes load asynchronously per level; refresh at
// every level; double-click a table/view to open a Browse Data tab.

import { useEffect, useState } from 'react'
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  Database,
  Layers,
  Table,
  Eye,
  Boxes,
  Code2,
  Hash,
  Shapes,
  Puzzle,
  List,
  Key,
  Link2,
  Shield,
  Zap,
  FolderTree
} from 'lucide-react'
import type { ExplorerNode } from '@shared/models/explorer'
import { useExplorerStore } from '@renderer/state/explorer'
import { useConnectionsStore } from '@renderer/state/connections'
import { useEditorStore } from '@renderer/state/editor'
import { useContextMenu, ContextMenuView, type ContextMenuItem } from './ContextMenu'

const ICONS: Record<string, JSX.Element> = {
  connection: <Database size={12} />,
  databases: <Database size={12} />,
  database: <Database size={12} />,
  schemas: <Layers size={12} />,
  schema: <Layers size={12} />,
  tables: <Table size={12} />,
  table: <Table size={12} />,
  views: <Eye size={12} />,
  view: <Eye size={12} />,
  matviews: <Boxes size={12} />,
  matview: <Boxes size={12} />,
  functions: <Code2 size={12} />,
  function: <Code2 size={12} />,
  procedures: <Code2 size={12} />,
  procedure: <Code2 size={12} />,
  sequences: <Hash size={12} />,
  sequence: <Hash size={12} />,
  types: <Shapes size={12} />,
  type: <Shapes size={12} />,
  extensions: <Puzzle size={12} />,
  extension: <Puzzle size={12} />,
  columns: <List size={12} />,
  column: <List size={12} />,
  index: <Zap size={12} />,
  indexes: <Zap size={12} />,
  'foreign-keys': <Link2 size={12} />,
  'foreign-key': <Key size={12} />,
  constraints: <Shield size={12} />,
  constraint: <Shield size={12} />,
  triggers: <Zap size={12} />,
  trigger: <Zap size={12} />,
  catalog: <FolderTree size={12} />
}

export function ExplorerPanel(): JSX.Element {
  const connections = useConnectionsStore((s) => s.connections)
  const openInfo = useConnectionsStore((s) => s.openInfo)
  const activeConnectionId = useExplorerStore((s) => s.activeConnectionId)
  const setActiveConnection = useExplorerStore((s) => s.setActiveConnection)
  const refresh = useExplorerStore((s) => s.refresh)
  const rootChildren = useExplorerStore((s) =>
    activeConnectionId ? s.childrenByKey[activeConnectionId + ':'] : undefined
  )
  const loadingKey = useExplorerStore((s) => s.loadingKey)
  const { menu, open, close } = useContextMenu()

  useEffect(() => {
    if (!activeConnectionId) {
      const firstOpen = Object.keys(openInfo)[0]
      if (firstOpen) setActiveConnection(firstOpen)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(openInfo).join(',')])

  return (
    <div className="panel explorer-panel">
      <div className="panel-header">
        <span className="panel-title">Explorer</span>
        <select
          className="explorer-conn-select"
          value={activeConnectionId ?? ''}
          onChange={(e) => setActiveConnection(e.target.value || null)}
        >
          <option value="">No connection</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {openInfo[c.id] ? ' ●' : ''}
            </option>
          ))}
        </select>
        <button
          className="btn icon-only"
          title="Refresh metadata (Ctrl+Shift+R)"
          disabled={!activeConnectionId}
          onClick={() => activeConnectionId && void refresh(activeConnectionId)}
        >
          {loadingKey === activeConnectionId + ':' ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>
      </div>
      <div className="tree">
        {!activeConnectionId && <div className="tree-empty">Select a connection.</div>}
        {activeConnectionId &&
          (rootChildren ?? []).map((node) => (
            <ExplorerNodeRow key={node.key} node={node} depth={0} onMenu={open} />
          ))}
        {activeConnectionId && rootChildren === undefined && (
          <div className="tree-empty">
            <Loader2 size={12} className="spin" /> loading…
          </div>
        )}
      </div>
      {menu && <ContextMenuView menu={menu} onClose={close} />}
    </div>
  )
}

function ExplorerNodeRow(props: {
  node: ExplorerNode
  depth: number
  onMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void
}): JSX.Element {
  const { node, depth } = props
  const connId = useExplorerStore((s) => s.activeConnectionId) ?? ''
  const expanded = useExplorerStore((s) => s.isExpanded(connId, node.key))
  const toggle = useExplorerStore((s) => s.toggle)
  const loadChildren = useExplorerStore((s) => s.loadChildren)
  const openBrowse = useEditorStore((s) => s.openBrowse)
  const children = useExplorerStore((s) => s.childrenByKey[connId + ':' + node.key])
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  const browseable = ['table', 'view', 'matview'].includes(node.kind)

  function buildMenu(): ContextMenuItem[] {
    return [
      ...(browseable
        ? [
            {
              label: 'Browse Data',
              action: () => {
                const [, schema, table] = node.key.split(':')
                void openBrowse(connId, { schema, table })
              }
            }
          ]
        : []),
      {
        label: 'Refresh',
        separatorBefore: browseable,
        action: () => void loadChildren(connId, node.key, true)
      },
      { label: 'Copy Name', action: () => void navigator.clipboard.writeText(node.name) }
    ]
  }

  return (
    <>
      <div
        className={'tree-row' + (expanded ? ' expanded' : '')}
        style={{ paddingLeft: 6 + depth * 13 }}
        onClick={() => node.hasChildren && connId && void toggle(connId, node)}
        onDoubleClick={() => {
          if (browseable && connId) {
            const [, schema, table] = node.key.split(':')
            void openBrowse(connId, { schema, table })
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, items: buildMenu() })
        }}
      >
        <span className="chevron">
          {node.hasChildren ?
            children === undefined && expanded ? (
              <Loader2 size={11} className="spin" />
            ) : expanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            ) : null}
        </span>
        <span className="icon">{ICONS[node.kind] ?? <FolderTree size={12} />}</span>
        <span className="label" title={node.comment ?? node.name}>
          {node.name}
        </span>
        {typeof node.count === 'number' && <span className="count-chip">{node.count}</span>}
      </div>
      {expanded &&
        (children ?? []).map((child) => (
          <ExplorerNodeRow key={child.key} node={child} depth={depth + 1} onMenu={props.onMenu} />
        ))}
      {menu && <ContextMenuView menu={menu} onClose={() => setMenu(null)} />}
    </>
  )
}
