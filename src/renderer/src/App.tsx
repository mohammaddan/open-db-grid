import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TopToolbar } from './components/TopToolbar'
import { ConnectionSidebar } from './components/ConnectionSidebar'
import { ExplorerPanel } from './components/ExplorerPanel'
import { EditorArea } from './components/EditorArea'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog } from './components/ConfirmDialog'
import { QueryHistoryPanel } from './components/QueryHistoryPanel'
import { SavedQueriesPanel } from './components/SavedQueriesPanel'
import { ConnectionFormDialog } from './components/ConnectionFormDialog'
import { Toasts } from './components/Toasts'
import { useConnectionsStore } from './state/connections'
import { useSettingsStore } from './state/settings'
import { useEditorStore } from './state/editor'
import { setupShortcuts } from './lib/shortcuts'

export function App(): JSX.Element {
  const initConnections = useConnectionsStore((s) => s.init)
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    void initConnections()
    void loadSettings()
    const disposers = setupShortcuts()
    return () => disposers.forEach((d) => d())
  }, [initConnections, loadSettings])

  // refresh txn states + open-connection badges for auto-opened connections
  useEffect(() => {
    const timer = setInterval(() => {
      for (const connId of Object.keys(useEditorStore.getState().txnState)) {
        void useEditorStore.getState().refreshTxnState(connId)
      }
      void useConnectionsStore.getState().refreshOpen()
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="app">
      <TopToolbar />
      <div className="app-main">
        <PanelGroup direction="horizontal" autoSaveId="dbforge-main">
          <Panel defaultSize={26} minSize={16} maxSize={40}>
            <PanelGroup direction="vertical" autoSaveId="dbforge-left">
              <Panel defaultSize={50} minSize={25}>
                <ConnectionSidebar />
              </Panel>
              <PanelResizeHandle className="resize-h" />
              <Panel defaultSize={50} minSize={15}>
                <ExplorerPanel />
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="resize-v" />
          <Panel minSize={40}>
            <EditorArea />
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
      <CommandPalette />
      <QueryHistoryPanel />
      <SavedQueriesPanel />
      <ConnectionFormDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}