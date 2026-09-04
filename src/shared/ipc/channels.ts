// Single source of truth for IPC channel names + request signatures.

export const IPC = {
  appInfo: 'app:info',
  // connections ------------------------------------------------------------
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsDelete: 'connections:delete',
  connectionsDuplicate: 'connections:duplicate',
  connectionsTest: 'connections:test',
  connectionsConnect: 'connections:connect',
  connectionsDisconnect: 'connections:disconnect',
  connectionsListOpen: 'connections:list-open',
  connectionsTouch: 'connections:touch',
  connectionsDbInfo: 'connections:db-info',
  // groups -----------------------------------------------------------------
  groupsList: 'groups:list',
  groupsSave: 'groups:save',
  groupsDelete: 'groups:delete',
  groupsMove: 'groups:move',
  // query execution --------------------------------------------------------
  queryExecute: 'query:execute',
  queryExecuteScript: 'query:execute-script',
  queryExplain: 'query:explain',
  queryPage: 'query:page',
  queryCancel: 'query:cancel',
  queryClose: 'query:close',
  queryExport: 'query:export',
  querySaveEdits: 'query:save-edits',
  // explorer ---------------------------------------------------------------
  explorerChildren: 'explorer:children',
  explorerPlan: 'explorer:plan',
  explorerBrowse: 'explorer:browse',
  // transactions -----------------------------------------------------------
  txnStatus: 'txn:status',
  txnBegin: 'txn:begin',
  txnCommit: 'txn:commit',
  txnRollback: 'txn:rollback',
  // history + saved queries ------------------------------------------------
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',
  savedList: 'saved:list',
  savedSave: 'saved:save',
  savedDelete: 'saved:delete',
  // settings + ui ----------------------------------------------------------
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  dialogExportFile: 'dialog:export-file'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]