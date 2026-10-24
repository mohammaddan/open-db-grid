import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc/channels'
import type { RendererApi } from '@shared/ipc/contract'
import type {
  ConnectionSaveRequest,
  ConnectionTestRequest
} from '@shared/models/connection'
import type { ExecuteRequest, ExplainRequest, ExportRequest } from '@shared/models/result'
import type { ExplorerChildrenRequest, BrowseTarget } from '@shared/models/explorer'
import type { SafeEditPlan, PendingEdit } from '@shared/models/explorer'
import type { AppSettings } from '@shared/models/settings'
import type { SavedQuery } from '@shared/models/history'

const api: RendererApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  connections: {
    list: () => ipcRenderer.invoke(IPC.connectionsList),
    save: (req: ConnectionSaveRequest) => ipcRenderer.invoke(IPC.connectionsSave, req),
    remove: (id: string) => ipcRenderer.invoke(IPC.connectionsDelete, id),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.connectionsDuplicate, id),
    test: (req: ConnectionTestRequest) => ipcRenderer.invoke(IPC.connectionsTest, req),
    connect: (id: string) => ipcRenderer.invoke(IPC.connectionsConnect, id),
    disconnect: (id: string) => ipcRenderer.invoke(IPC.connectionsDisconnect, id),
    listOpen: () => ipcRenderer.invoke(IPC.connectionsListOpen),
    touch: (id: string) => ipcRenderer.invoke(IPC.connectionsTouch, id),
    dbInfo: (id: string) => ipcRenderer.invoke(IPC.connectionsDbInfo, id)
  },
  groups: {
    list: () => ipcRenderer.invoke(IPC.groupsList),
    save: (g) => ipcRenderer.invoke(IPC.groupsSave, g),
    remove: (id: string) => ipcRenderer.invoke(IPC.groupsDelete, id),
    move: (groupId: string, newParentId: string | null, order: number) =>
      ipcRenderer.invoke(IPC.groupsMove, groupId, newParentId, order)
  },
  query: {
    execute: (req: ExecuteRequest) => ipcRenderer.invoke(IPC.queryExecute, req),
    executeScript: (req: ExecuteRequest) => ipcRenderer.invoke(IPC.queryExecuteScript, req),
    explain: (req: ExplainRequest) => ipcRenderer.invoke(IPC.queryExplain, req),
    page: (connectionId: string, sessionId: string, pageSize?: number) =>
      ipcRenderer.invoke(IPC.queryPage, connectionId, sessionId, pageSize),
    cancel: (connectionId: string, sessionId: string) =>
      ipcRenderer.invoke(IPC.queryCancel, connectionId, sessionId),
    close: (connectionId: string, sessionId: string) =>
      ipcRenderer.invoke(IPC.queryClose, connectionId, sessionId),
    exportResult: (req: ExportRequest) => ipcRenderer.invoke(IPC.queryExport, req),
    saveEdits: (connectionId: string, plan: SafeEditPlan, edits: PendingEdit[]) =>
      ipcRenderer.invoke(IPC.querySaveEdits, connectionId, plan, edits)
  },
  explorer: {
    children: (req: ExplorerChildrenRequest) => ipcRenderer.invoke(IPC.explorerChildren, req),
    plan: (connectionId: string, sql: string, columns: string[]) =>
      ipcRenderer.invoke(IPC.explorerPlan, connectionId, sql, columns),
    browse: (connectionId: string, target: BrowseTarget, pageSize?: number) =>
      ipcRenderer.invoke(IPC.explorerBrowse, connectionId, target, pageSize)
  },
  txn: {
    status: (connectionId: string) => ipcRenderer.invoke(IPC.txnStatus, connectionId),
    begin: (connectionId: string) => ipcRenderer.invoke(IPC.txnBegin, connectionId),
    commit: (connectionId: string) => ipcRenderer.invoke(IPC.txnCommit, connectionId),
    rollback: (connectionId: string) => ipcRenderer.invoke(IPC.txnRollback, connectionId)
  },
  history: {
    list: (connectionId?: string) => ipcRenderer.invoke(IPC.historyList, connectionId),
    remove: (id: string) => ipcRenderer.invoke(IPC.historyDelete, id),
    clear: (connectionId?: string) => ipcRenderer.invoke(IPC.historyClear, connectionId)
  },
  saved: {
    list: () => ipcRenderer.invoke(IPC.savedList),
    save: (q: Pick<SavedQuery, 'name' | 'sql' | 'connectionId'>) =>
      ipcRenderer.invoke(IPC.savedSave, q),
    remove: (id: string) => ipcRenderer.invoke(IPC.savedDelete, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  dialog: {
    chooseExportFile: (defaultName: string) =>
      ipcRenderer.invoke(IPC.dialogExportFile, defaultName)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    maximize: () => ipcRenderer.invoke(IPC.windowMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      const handler = (_: unknown, val: boolean) => callback(val)
      ipcRenderer.on('window:maximized-change', handler)
      return () => {
        ipcRenderer.removeListener('window:maximized-change', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)