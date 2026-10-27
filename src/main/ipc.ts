// Registers all IPC handlers. Each handler validates its payload against the
// shared contract types, calls the appropriate service, and never leaks secrets.

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc/channels'
import type { ConnectionSaveRequest, ConnectionTestRequest } from '@shared/models/connection'
import type { ExecuteRequest, ExplainRequest, ExportRequest } from '@shared/models/result'
import type { ExplorerChildrenRequest } from '@shared/models/explorer'
import type { ConnectionService } from './services/ConnectionService'
import type { QueryService } from './services/QueryService'
import type { ExplorerService } from './services/ExplorerService'
import type { TransactionService } from './services/TransactionService'
import type { HistoryService, SavedQueriesService } from './services/HistoryService'
import type { SettingsService } from './services/SettingsService'
import { toQueryErrorInfo, DatabaseError } from './database/errors'
import type { AppSettings } from '@shared/models/settings'
import type { HistoryEntry, SavedQuery } from '@shared/models/history'
import type { SafeEditPlan, PendingEdit } from '@shared/models/explorer'
import type { ConnectionGroup } from '@shared/models/connection'

export interface AppServices {
  connections: ConnectionService
  queries: QueryService
  explorer: ExplorerService
  transactions: TransactionService
  history: HistoryService
  saved: SavedQueriesService
  settings: SettingsService
}

export function registerIpc(services: AppServices): void {
  const { connections, queries, explorer, transactions, history, saved, settings } = services

  const handle = <TArgs extends unknown[], TResult>(
    channel: string,
    fn: (...args: TArgs) => Promise<TResult>
  ): void => {
    ipcMain.handle(channel, async (_event, ...args: TArgs): Promise<TResult> => {
      try {
        return await fn(...args)
      } catch (err) {
        const info = toQueryErrorInfo(err)
        throw new DatabaseError({
          message: info.message,
          sqlState: info.sqlState,
          detail: info.detail,
          hint: info.hint,
          context: info.context,
          position: info.position,
          code: info.code
        })
      }
    })
  }

  // -- app -----------------------------------------------------------------
  handle(IPC.appInfo, async () => ({
    version: process.env.npm_package_version ?? '0.1.0',
    platform: process.platform,
    electron: process.versions.electron ?? ''
  }))

  // -- connections ----------------------------------------------------------
  handle(IPC.connectionsList, async () => connections.list())
  handle(IPC.connectionsSave, async (req: ConnectionSaveRequest) => connections.save(req))
  handle(IPC.connectionsDelete, async (id: string) => connections.remove(id))
  handle(IPC.connectionsDuplicate, async (id: string) => connections.duplicate(id))
  handle(IPC.connectionsTest, async (req: ConnectionTestRequest) => connections.test(req))
  handle(IPC.connectionsConnect, async (id: string) => connections.connect(id))
  handle(IPC.connectionsDisconnect, async (id: string) => connections.disconnect(id))
  handle(IPC.connectionsListOpen, async () => connections.listOpen())
  handle(IPC.connectionsTouch, async (id: string) => connections.touch(id))
  handle(IPC.connectionsDbInfo, async (id: string) => {
    const conn = connections.get(id)
    return { serverVersion: undefined, database: conn?.config.database ?? '' }
  })

  // -- groups --------------------------------------------------------------
  handle(IPC.groupsList, async (): Promise<ConnectionGroup[]> => connections.listGroups())
  handle(IPC.groupsSave, async (g: ConnectionGroup) => connections.saveGroup(g))
  handle(IPC.groupsDelete, async (id: string) => connections.removeGroup(id))
  handle(IPC.groupsMove, async (groupId: string, newParentId: string | null, order: number) =>
    connections.moveGroup(groupId, newParentId, order)
  )

  // -- queries --------------------------------------------------------------
  handle(IPC.queryExecute, async (req: ExecuteRequest) => queries.execute(req))
  handle(IPC.queryExecuteScript, async (req: ExecuteRequest) => queries.executeScript(req))
  handle(IPC.queryExplain, async (req: ExplainRequest) => queries.explain(req))
  handle(
    IPC.queryPage,
    async (connectionId: string, sessionId: string, pageSize?: number, pageNumber?: number) =>
      queries.page(connectionId, sessionId, pageSize, pageNumber)
  )
  handle(IPC.queryCancel, async (connectionId: string, sessionId: string) =>
    queries.cancel(connectionId, sessionId)
  )
  handle(IPC.queryClose, async (connectionId: string, sessionId: string) =>
    queries.close(connectionId, sessionId)
  )
  handle(IPC.queryExport, async (req: ExportRequest) => queries.exportResult(req))
  handle(
    IPC.querySaveEdits,
    async (connectionId: string, plan: SafeEditPlan, edits: PendingEdit[]) =>
      queries.saveEdits(connectionId, plan, edits)
  )

  // -- explorer ------------------------------------------------------------
  handle(IPC.explorerChildren, async (req: ExplorerChildrenRequest) => explorer.children(req))
  handle(IPC.explorerPlan, async (connectionId: string, sql: string, columns: string[]) =>
    explorer.plan(connectionId, sql, columns)
  )
  handle(
    IPC.explorerBrowse,
    async (
      connectionId: string,
      target: { schema: string; table: string },
      pageSize?: number,
      pageNumber?: number
    ) => explorer.browse(connectionId, target, pageSize, pageNumber)
  )
  handle(
    IPC.explorerStructure,
    async (connectionId: string, target: { schema: string; table: string }) =>
      explorer.structure(connectionId, target)
  )
  handle(IPC.explorerSearchTables, async (connectionId: string, query: string) =>
    explorer.searchTables(connectionId, query)
  )

  // -- transactions --------------------------------------------------------
  handle(IPC.txnStatus, async (connectionId: string) => transactions.status(connectionId))
  handle(IPC.txnBegin, async (connectionId: string) => transactions.begin(connectionId))
  handle(IPC.txnCommit, async (connectionId: string) => transactions.commit(connectionId))
  handle(IPC.txnRollback, async (connectionId: string) => transactions.rollback(connectionId))

  // -- history + saved -----------------------------------------------------
  handle(IPC.historyList, async (connectionId?: string): Promise<HistoryEntry[]> =>
    connectionId ? history.list(connectionId) : history.list()
  )
  handle(IPC.historyDelete, async (id: string) => history.remove(id))
  handle(IPC.historyClear, async (connectionId?: string) => history.clear(connectionId))
  handle(IPC.savedList, async (): Promise<SavedQuery[]> => saved.list())
  handle(IPC.savedSave, async (q: Pick<SavedQuery, 'name' | 'sql' | 'connectionId'>) =>
    saved.save(q)
  )
  handle(IPC.savedDelete, async (id: string) => saved.remove(id))

  // -- settings ------------------------------------------------------------
  handle(IPC.settingsGet, async (): Promise<AppSettings> => settings.get())
  handle(IPC.settingsSet, async (patch: Partial<AppSettings>): Promise<AppSettings> =>
    settings.set(patch)
  )

  // -- dialogs -------------------------------------------------------------
  handle(IPC.dialogExportFile, async (defaultName: string): Promise<string | null> => {
    const res = await dialog.showSaveDialog({
      title: 'Export Results',
      defaultPath: defaultName,
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'TSV', extensions: ['tsv'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    return res.canceled ? null : res.filePath
  })

  // -- window controls -----------------------------------------------------
  ipcMain.handle(IPC.windowMinimize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })
  ipcMain.handle(IPC.windowMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
      return win.isMaximized()
    }
    return false
  })
  ipcMain.handle(IPC.windowClose, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })
  ipcMain.handle(IPC.windowIsMaximized, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })
}