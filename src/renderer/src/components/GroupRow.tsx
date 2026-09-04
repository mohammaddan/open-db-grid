import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import type { ConnectionGroup } from '@shared/models/connection'

interface GroupRowProps {
  group: ConnectionGroup
  depth: number
  expanded: boolean
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  root?: boolean
}

/** A group row: draggable (re-parent) and droppable (children go inside). */
export function GroupRow({
  group,
  depth,
  expanded,
  onToggle,
  onContextMenu,
  root = false
}: GroupRowProps): JSX.Element {
  const id = root ? 'root-drop' : group.id
  const drag = useDraggable({
    id,
    data: { kind: 'group', groupId: group.id ?? null },
    disabled: root
  })
  const drop = useDroppable({
    id,
    data: { kind: 'group-drop', groupId: group.id ?? null }
  })

  const cls = ['tree-row', 'group-row', drop.isOver ? 'dnd-over' : ''].filter(Boolean).join(' ')

  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={cls}
      style={{ paddingLeft: 6 + depth * 14, opacity: drag.isDragging ? 0.4 : 1 }}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onContextMenu={onContextMenu}
      {...drag.attributes}
      {...drag.listeners}
    >
      {depth === 0 && !root ? null : (
        <span className="chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      )}
      {expanded ? <FolderOpen size={13} className="icon" /> : <Folder size={13} className="icon" />}
      <span className="label">{group.name}</span>
    </div>
  )
}