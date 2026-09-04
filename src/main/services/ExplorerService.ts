// ExplorerService: lazy, async metadata tree backed by the driver's catalog
// queries. The renderer never emits SQL; it requests children by typed source.

import type { ExplorerChildrenRequest, ExplorerNode, BrowseTarget, SafeEditPlan } from '@shared/models/explorer'
import type { ExecuteResult } from '@shared/models/result'
import type { ExploreSource } from '@shared/models/explorer'
import { ConnectionService } from './ConnectionService'

export class ExplorerService {
  constructor(private readonly connections: ConnectionService) {}

  async children(req: ExplorerChildrenRequest): Promise<ExplorerNode[]> {
    const session = this.connections.getSession(req.connectionId)
    const source = req.parentKey === null ? ({ kind: 'roots' } as ExploreSource) : parseKey(req.parentKey)
    return session.explore(source, req.forceRefresh ?? false)
  }

  async plan(connectionId: string, sql: string, resultColumnNames: string[]): Promise<SafeEditPlan> {
    const session = this.connections.getSession(connectionId)
    return session.planForSelect(sql, resultColumnNames)
  }

  async browse(connectionId: string, target: BrowseTarget, pageSize?: number): Promise<ExecuteResult> {
    const session = this.connections.getSession(connectionId)
    return session.browse(target, pageSize)
  }
}

/** Converts an ExplorerNode.key into a typed explore source. */
export function parseKey(key: string): ExploreSource {
  const [prefix, ...rest] = key.split(':')
  switch (prefix) {
    case 'databases':
      return { kind: 'databases' }
    case 'schemas':
      return { kind: 'schemas' }
    case 'extensions':
      return { kind: 'schema-extensions', schema: '' }
    case 'schema':
      return { kind: 'schema-sections', schema: rest[0] }
    case 'table':
      return { kind: 'table-sections', schema: rest[0], table: rest[1] }
    case 'view':
      return { kind: 'view-columns', schema: rest[0], table: rest[1] }
    case 'matview':
      return { kind: 'matview-columns', schema: rest[0], table: rest[1] }
    case 'tables':
      return { kind: 'schema-tables', schema: rest[0] }
    case 'views':
      return { kind: 'schema-views', schema: rest[0] }
    case 'functions':
      return { kind: 'schema-functions', schema: rest[0] }
    case 'procedures':
      return { kind: 'schema-procedures', schema: rest[0] }
    case 'sequences':
      return { kind: 'schema-sequences', schema: rest[0] }
    case 'types':
      return { kind: 'schema-types', schema: rest[0] }
    case 'table-columns':
      return { kind: 'table-columns', schema: rest[0], table: rest[1] }
    case 'view-columns':
      return { kind: 'view-columns', schema: rest[0], table: rest[1] }
    case 'matview-columns':
      return { kind: 'matview-columns', schema: rest[0], table: rest[1] }
    case 'table-indexes':
      return { kind: 'table-indexes', schema: rest[0], table: rest[1] }
    case 'table-fks':
      return { kind: 'table-fks', schema: rest[0], table: rest[1] }
    case 'table-constraints':
      return { kind: 'table-constraints', schema: rest[0], table: rest[1] }
    case 'table-triggers':
      return { kind: 'table-triggers', schema: rest[0], table: rest[1] }
    default:
      return { kind: 'roots' }
  }
}