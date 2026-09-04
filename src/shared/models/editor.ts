// Editor-facing completion model, derived from explorer metadata nodes.
// The renderer never queries the catalog itself — it reshapes what the
// driver already returned for the explorer tree.

import type { ExplorerNode } from './explorer'

export type CompletionKind =
  | 'keyword'
  | 'schema'
  | 'table'
  | 'view'
  | 'matview'
  | 'column'
  | 'function'
  | 'procedure'
  | 'sequence'
  | 'type'

export interface CompletionItem {
  label: string
  type: CompletionKind
  detail?: string
  /** dotted qualified name, e.g. "public.users" (tables/views/columns) */
  schemaTable: string
  /** unqualified base table this item belongs to (columns) */
  table?: string
}

const KEYWORDS = [
  'select', 'from', 'where', 'insert', 'update', 'delete', 'join', 'left', 'right', 'inner',
  'outer', 'on', 'group by', 'order by', 'having', 'limit', 'offset', 'union', 'all',
  'with', 'returning', 'distinct', 'as', 'and', 'or', 'not', 'null', 'is', 'in', 'exists',
  'between', 'like', 'ilike', 'case', 'when', 'then', 'else', 'end', 'cast', 'begin',
  'commit', 'rollback', 'create', 'alter', 'drop', 'truncate', 'explain', 'analyze',
  'asc', 'desc', 'interval', 'current_date', 'current_timestamp'
]

function splitKey(key: string): string[] {
  return key.split(':')
}

export function deriveCompletions(nodes: ExplorerNode[]): CompletionItem[] {
  const out: CompletionItem[] = []
  const seen = new Set<string>()
  const push = (item: CompletionItem): void => {
    const k = `${item.type}:${item.schemaTable}:${item.label}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(item)
    }
  }

  for (const n of nodes) {
    const parts = splitKey(n.key)
    switch (n.kind) {
      case 'schema':
        push({ label: n.name, type: 'schema', schemaTable: n.name })
        break
      case 'table':
      case 'view':
      case 'matview': {
        // key: `table:schema:name` / `view:schema:name` / `matview:schema:name`
        const schema = parts[1] ?? ''
        const name = parts[2] ?? n.name
        push({
          label: name,
          type: n.kind,
          detail: schema,
          schemaTable: schema ? `${schema}.${name}` : name,
          table: name
        })
        break
      }
      case 'column': {
        // key: `column:schema:table:name`
        const schema = parts[1] ?? ''
        const table = parts[2] ?? ''
        push({
          label: parts[3] ?? n.name,
          type: 'column',
          detail: table,
          schemaTable: schema && table ? `${schema}.${table}` : table,
          table
        })
        break
      }
      case 'function':
      case 'procedure':
        push({ label: `${n.name}()`, type: n.kind, schemaTable: '' })
        break
      case 'sequence':
        push({ label: n.name, type: 'sequence', schemaTable: '' })
        break
      case 'type':
        push({ label: n.name, type: 'type', schemaTable: '' })
        break
      default:
        break
    }
  }

  for (const kw of KEYWORDS) {
    push({ label: kw.toUpperCase(), type: 'keyword', schemaTable: '' })
  }
  return out
}
