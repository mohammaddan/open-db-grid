import type { IpcChannel } from './channels'
import type { DbConnection, ConnectionGroup, ConnectionSaveRequest, ConnectionTestRequest, ConnectionTestResult, OpenConnectionInfo } from '../models/connection'
import type { AppSettings } from '../models/settings'
import type { ExecuteRequest, ExecuteResult, ExplainRequest, ExplainResult, QueryPage, QueryErrorInfo, CancelResult, ExportRequest, ExportResult } from '../models/result'
import type { ExplorerNode, ExplorerChildrenRequest, BrowseTarget, SafeEditPlan, PendingEdit, SaveEditsResult } from '../models/explorer'
import type { TransactionStatus, BeginTransactionResult } from '../models/transactions'
import type { HistoryEntry, SavedQuery } from '../models/history'

export { IPC } from './channels'
export type { IpcChannel } from './channels'
export type {
  DbConnection,
  ConnectionGroup,
  ConnectionSaveRequest,
  ConnectionTestRequest,
  ConnectionTestResult,
  OpenConnectionInfo,
  AppSettings,
  ExecuteRequest,
  ExecuteResult,
  ExplainRequest,
  ExplainResult,
  QueryPage,
  QueryErrorInfo,
  CancelResult,
  ExportRequest,
  ExportResult,
  ExplorerNode,
  ExplorerChildrenRequest,
  BrowseTarget,
  SafeEditPlan,
  PendingEdit,
  SaveEditsResult,
  TransactionStatus,
  BeginTransactionResult,
  HistoryEntry,
  SavedQuery
}

/** Typed surface exposed on window.api by the preload script. */
export interface RendererApi {
  app: {
    info: () => Promise<{ version: string; platform: string; electron: string }>
  }
  connections: {
    list: () => Promise<DbConnection[]>
    save: (req: ConnectionSaveRequest) => Promise<DbConnection>
    remove: (id: string) => Promise<void>
    duplicate: (id: string) => Promise<DbConnection>
    test: (req: ConnectionTestRequest) => Promise<ConnectionTestResult>
    connect: (id: string) => Promise<OpenConnectionInfo>
    disconnect: (id: string) => Promise<void>
    listOpen: () => Promise<OpenConnectionInfo[]>
    touch: (id: string) => Promise<void>
    dbInfo: (id: string) => Promise<{ serverVersion?: string; database: string }>
  }
  groups: {
    list: () => Promise<ConnectionGroup[]>
    save: (g: ConnectionGroup) => Promise<ConnectionGroup>
    remove: (id: string) => Promise<void>
    move: (groupId: string, newParentId: string | null, order: number) => Promise<void>
  }
  query: {
    execute: (req: ExecuteRequest) => Promise<ExecuteResult>
    executeScript: (req: ExecuteRequest) => Promise<ExecuteResult>
    explain: (req: ExplainRequest) => Promise<ExplainResult>
    page: (connectionId: string, sessionId: string, pageSize?: number) => Promise<QueryPage>
    cancel: (connectionId: string, sessionId: string) => Promise<CancelResult>
    close: (connectionId: string, sessionId: string) => Promise<void>
    exportResult: (req: ExportRequest) => Promise<ExportResult>
    saveEdits: (
      connectionId: string,
      plan: SafeEditPlan,
      edits: PendingEdit[]
    ) => Promise<SaveEditsResult>
  }
  explorer: {
    children: (req: ExplorerChildrenRequest) => Promise<ExplorerNode[]>
    plan: (connectionId: string, sql: string, resultColumnNames: string[]) => Promise<SafeEditPlan>
    browse: (
      connectionId: string,
      target: BrowseTarget,
      pageSize?: number
    ) => Promise<ExecuteResult>
  }
  txn: {
    status: (connectionId: string) => Promise<TransactionStatus>
    begin: (connectionId: string) => Promise<BeginTransactionResult>
    commit: (connectionId: string) => Promise<BeginTransactionResult>
    rollback: (connectionId: string) => Promise<BeginTransactionResult>
  }
  history: {
    list: (connectionId?: string) => Promise<HistoryEntry[]>
    remove: (id: string) => Promise<void>
    clear: (connectionId?: string) => Promise<void>
  }
  saved: {
    list: () => Promise<SavedQuery[]>
    save: (q: Pick<SavedQuery, 'name' | 'sql' | 'connectionId'>) => Promise<SavedQuery>
    remove: (id: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  dialog: {
    /** opens a save dialog; returns chosen path or null */
    chooseExportFile: (defaultName: string) => Promise<string | null>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
  }
}

export function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}