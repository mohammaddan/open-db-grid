import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Server, ShieldCheck } from 'lucide-react'
import type { DbConnection, ConnectionColor } from '@shared/models/connection'

interface Props {
  connection: DbConnection
  depth: number
  connected: boolean
  selected: boolean
  color: ConnectionColor
  onSelect: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

/** A connection row: draggable (move into a group) + droppable (move to its group). */
export function ConnectionRow({
  connection,
  depth,
  connected,
  selected,
  color,
  onSelect,
  onDoubleClick,
  onContextMenu
}: Props): JSX.Element {
  const drag = useDraggable({
    id: connection.id,
    data: { kind: 'connection', groupId: connection.groupId }
  })
  const drop = useDroppable({
    id: `conn:${connection.id}`,
    data: { kind: 'connection-drop', groupId: connection.groupId }
  })

  const cls = [
    'tree-row',
    'conn-row',
    connected ? 'connected' : '',
    selected ? 'selected' : '',
    drop.isOver ? 'dnd-over' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={cls}
      style={{ paddingLeft: 8 + depth * 14, opacity: drag.isDragging ? 0.4 : 1 }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      {...drag.attributes}
      {...drag.listeners}
      title={`${connection.config.host}:${connection.config.port}/${connection.config.database}`}
    >
      {connection.accessMode === 'read-only' ? (
        <ShieldCheck size={12} className="icon" style={{ color: 'var(--readonly)' }} />
      ) : (
        <Server size={12} className="icon" style={{ color: color.value }} />
      )}
      <span className="dot" style={{ background: color.value }} />
      <span className="label">{connection.name}</span>
      {connection.production && <span className="tag" style={{ background: 'rgba(229,83,75,.14)', color: '#e5534b' }}>prod</span>}
      {connection.accessMode === 'read-only' && <span className="readonly-badge">read only</span>}
      {connected && <span className="badge">●</span>}
    </div>
  )
}