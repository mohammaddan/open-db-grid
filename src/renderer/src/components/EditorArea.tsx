// Central workspace: tab strip (multiple SQL tabs) + active tab pane with
// the CodeMirror editor and the result grid in a resizable vertical split.
// Features horizontal wheel scrolling, auto-scroll to active tab, scroll buttons,
// new tab shortcut (+), and a quick tab switcher dropdown.

import { useRef, useEffect, useState, useMemo } from 'react'
import { X, Circle, ChevronLeft, ChevronRight, Plus, ChevronDown, ListFilter, WrapText, Table, Layers } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useEditorStore, type EditorTab } from '@renderer/state/editor'
import { useConnectionsStore } from '@renderer/state/connections'
import { useExplorerStore } from '@renderer/state/explorer'
import { closeTabSafe } from '@renderer/lib/shortcuts'
import { SqlEditor } from './SqlEditor'
import { ResultTable } from './ResultTable'
import { TableStructureView } from './TableStructureView'
import { colorOf } from '@shared/models/connection'

export function EditorArea(): JSX.Element {
  const allTabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const activate = useEditorStore((s) => s.activate)
  const switchConnection = useEditorStore((s) => s.switchConnection)
  const newQueryTab = useEditorStore((s) => s.newQueryTab)
  const selectedConnId = useConnectionsStore((s) => s.selectedId)
  const connections = useConnectionsStore((s) => s.connections)

  const tabStripRef = useRef<HTMLDivElement | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [multiRow, setMultiRow] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // Switch session tab context when connection changes
  useEffect(() => {
    switchConnection(selectedConnId)
  }, [selectedConnId, switchConnection])

  // Filter tabs for the active connection session
  const visibleTabs = useMemo(() => {
    if (selectedConnId) {
      return allTabs.filter((t) => t.connectionId === selectedConnId)
    }
    const noConnTabs = allTabs.filter((t) => !t.connectionId)
    return noConnTabs.length > 0 ? noConnTabs : allTabs
  }, [allTabs, selectedConnId])

  const active = useMemo(() => {
    if (visibleTabs.length === 0) return null
    return visibleTabs.find((t) => t.id === activeId) ?? visibleTabs[0]
  }, [visibleTabs, activeId])

  // Auto-activate valid tab when activeId doesn't match
  useEffect(() => {
    if (active && active.id !== activeId) {
      activate(active.id)
    }
  }, [active, activeId, activate])

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!tabStripRef.current || !active?.id || multiRow) return
    const activeEl = tabStripRef.current.querySelector<HTMLElement>(`[data-tab-id="${active.id}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [active?.id, visibleTabs.length, multiRow])

  // Native non-passive wheel listener for horizontal tab scrolling
  useEffect(() => {
    const el = tabStripRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (multiRow) return
      if (e.deltaY !== 0 || e.deltaX !== 0) {
        e.preventDefault()
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        el.scrollLeft += delta * 1.5
      }
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [multiRow])

  // Close tab list dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [dropdownOpen])

  const scrollTabs = (offset: number) => {
    if (tabStripRef.current) {
      tabStripRef.current.scrollBy({ left: offset, behavior: 'smooth' })
    }
  }

  const currentConn = useMemo(() => {
    return connections.find((c) => c.id === selectedConnId)
  }, [connections, selectedConnId])

  // Tabs open in other connection sessions for the dropdown
  const otherSessions = useMemo(() => {
    return connections
      .filter((c) => c.id !== selectedConnId)
      .map((c) => ({
        conn: c,
        tabs: allTabs.filter((t) => t.connectionId === c.id)
      }))
      .filter((g) => g.tabs.length > 0)
  }, [connections, allTabs, selectedConnId])

  if (visibleTabs.length === 0 || !active) {
    return (
      <div className="editor-area">
        <div className="tab-strip-wrapper">
          {currentConn && (
            <div className="tab-connection-badge" title={`Active connection: ${currentConn.name}`}>
              <span className="dot" style={{ backgroundColor: colorOf(currentConn.color).value }} />
              <span className="conn-name">{currentConn.name}</span>
            </div>
          )}
          <button
            className="tab-nav-btn"
            title="New Query Tab (Ctrl+T)"
            onClick={() => newQueryTab(selectedConnId, '')}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="editor-empty">
          <p>No query tabs open for {currentConn ? `"${currentConn.name}"` : 'this connection'}.</p>
          <button className="btn primary cyber-btn" onClick={() => newQueryTab(selectedConnId, '')}>
            <Plus size={13} style={{ marginRight: 6 }} /> New Query (Ctrl+T)
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-area">
      <div className="tab-strip-wrapper">
        {currentConn && (
          <div className="tab-connection-badge" title={`Active connection: ${currentConn.name}`}>
            <span className="dot" style={{ backgroundColor: colorOf(currentConn.color).value }} />
            <span className="conn-name">{currentConn.name}</span>
          </div>
        )}

        {!multiRow && (
          <button
            className="tab-nav-btn"
            title="Scroll tabs left"
            onClick={() => scrollTabs(-240)}
          >
            <ChevronLeft size={13} />
          </button>
        )}

        <div
          ref={tabStripRef}
          className={'tab-strip editor-tabbar' + (multiRow ? ' multi-row' : '')}
        >
          {visibleTabs.map((t) => (
            <TabChip
              key={t.id}
              tab={t}
              active={t.id === active.id}
              onActivate={() => activate(t.id)}
              onClose={() => closeTabSafe(t.id)}
            />
          ))}
        </div>

        {!multiRow && (
          <button
            className="tab-nav-btn"
            title="Scroll tabs right"
            onClick={() => scrollTabs(240)}
          >
            <ChevronRight size={13} />
          </button>
        )}

        {/* Toggle multi-row wrapping vs single-row scrolling */}
        <button
          className={'tab-nav-btn' + (multiRow ? ' active' : '')}
          title={multiRow ? 'Switch to single-row scrollable tabs' : 'Wrap tabs into multiple rows'}
          onClick={() => setMultiRow((v) => !v)}
        >
          <WrapText size={13} />
        </button>

        <button
          className="tab-nav-btn"
          title="New Query Tab (Ctrl+T)"
          onClick={() => newQueryTab(selectedConnId, '')}
        >
          <Plus size={13} />
        </button>

        {/* Tab switcher dropdown with sessions grouped by connection */}
        <div className="tab-dropdown-container" ref={dropdownRef}>
          <button
            className={'tab-nav-btn' + (dropdownOpen ? ' active' : '')}
            title={`Tabs in this session (${visibleTabs.length})`}
            onClick={() => setDropdownOpen((v) => !v)}
          >
            <ChevronDown size={13} />
          </button>

          {dropdownOpen && (
            <div className="tab-dropdown-menu">
              <div className="tab-dropdown-header">
                <ListFilter size={12} />
                <span>{currentConn ? currentConn.name : 'Current Session'} ({visibleTabs.length})</span>
              </div>
              <div className="tab-dropdown-list">
                {visibleTabs.map((t) => (
                  <div
                    key={t.id}
                    className={'tab-dropdown-item' + (t.id === active.id ? ' active' : '')}
                    onClick={() => {
                      activate(t.id)
                      setDropdownOpen(false)
                    }}
                  >
                    <span className="tab-title">{t.title}</span>
                    {t.dirty && <Circle size={6} fill="currentColor" className="dirty-dot" />}
                    <button
                      className="close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTabSafe(t.id)
                      }}
                      title="Close tab"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}

                {/* Other Connection Sessions */}
                {otherSessions.map((grp) => (
                  <div key={grp.conn.id}>
                    <div className="tab-dropdown-group-header">
                      <span className="dot" style={{ backgroundColor: colorOf(grp.conn.color).value, width: 6, height: 6, borderRadius: '50%' }} />
                      <span>{grp.conn.name} ({grp.tabs.length})</span>
                    </div>
                    {grp.tabs.map((t) => (
                      <div
                        key={t.id}
                        className="tab-dropdown-item"
                        onClick={() => {
                          useConnectionsStore.getState().select(grp.conn.id)
                          useExplorerStore.getState().setActiveConnection(grp.conn.id)
                          activate(t.id)
                          setDropdownOpen(false)
                        }}
                      >
                        <span className="tab-title">{t.title}</span>
                        {t.dirty && <Circle size={6} fill="currentColor" className="dirty-dot" />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <TabPane key={active.id} tab={active} />
    </div>
  )
}

function TabChip(props: {
  tab: EditorTab
  active: boolean
  onActivate: () => void
  onClose: () => void
}): JSX.Element {
  const { tab, active } = props
  const conn = useConnectionsStore((s) =>
    tab.connectionId ? s.connections.find((c) => c.id === tab.connectionId) : undefined
  )
  const open = useConnectionsStore((s) =>
    tab.connectionId ? s.openInfo[tab.connectionId] : undefined
  )
  const color = conn ? colorOf(conn.color) : null

  return (
    <div
      data-tab-id={tab.id}
      className={'tab-chip editor-tab' + (active ? ' active' : '')}
      onClick={props.onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) props.onClose()
      }}
      title={conn ? conn.name + (conn.accessMode === 'read-only' ? ' (read-only)' : '') : 'No connection'}
      style={color && active ? { borderTopColor: color.value } : undefined}
    >
      {color && <span className="dot" style={{ background: color.value }} />}
      <span className="tab-title">{tab.title}</span>
      {(tab.dirty || tab.pending.length > 0) && <Circle size={7} className="dirty-dot" fill="currentColor" />}
      {tab.running && <span className="tab-running">…</span>}
      {open?.readOnly && <span className="ro-mini">RO</span>}
      <button
        className="tab-close close"
        onClick={(e) => {
          e.stopPropagation()
          props.onClose()
        }}
        title="Close tab (Ctrl+W)"
      >
        <X size={11} />
      </button>
    </div>
  )
}

function TabPane({ tab }: { tab: EditorTab }): JSX.Element {
  const setSql = useEditorStore((s) => s.setSql)
  const loadMore = useEditorStore((s) => s.loadMore)
  const applyEdit = useEditorStore((s) => s.applyEdit)
  const saveEdits = useEditorStore((s) => s.saveEdits)
  const discardEdits = useEditorStore((s) => s.discardEdits)
  const exportResult = useEditorStore((s) => s.exportResult)
  const run = useEditorStore((s) => s.run)
  const reloadBrowse = useEditorStore((s) => s.reloadBrowse)
  const setViewMode = useEditorStore((s) => s.setViewMode)

  // Auto-reload data for restored browse tabs
  useEffect(() => {
    if (tab.kind === 'browse' && !tab.result && !tab.running && tab.connectionId && tab.browseTarget) {
      void reloadBrowse(tab.id)
    }
  }, [tab.id, tab.kind, tab.result, tab.running, tab.connectionId, tab.browseTarget, reloadBrowse])

  const readOnly = useConnectionsStore(
    (s) => (tab.connectionId ? s.openInfo[tab.connectionId]?.readOnly : false) ?? false
  )
  const conn = useConnectionsStore((s) =>
    tab.connectionId ? s.connections.find((c) => c.id === tab.connectionId) : undefined
  )

  const isStructureView = tab.viewMode === 'structure' && tab.connectionId && tab.browseTarget

  return (
    <div className="tab-pane">
      {conn?.accessMode === 'read-only' && (
        <div className="readonly-banner">
          READ ONLY — {conn.name}. Data and schema modifications are disabled.
        </div>
      )}

      {tab.browseTarget && (
        <div className="tab-view-mode-bar">
          <div className="mode-segmented-control">
            <button
              className={'mode-btn' + (!isStructureView ? ' active' : '')}
              onClick={() => setViewMode(tab.id, 'data')}
            >
              <Table size={12} />
              <span>Data Grid</span>
            </button>
            <button
              className={'mode-btn' + (isStructureView ? ' active' : '')}
              onClick={() => setViewMode(tab.id, 'structure')}
            >
              <Layers size={12} />
              <span>Structure & Indexes</span>
            </button>
          </div>
        </div>
      )}

      {isStructureView ? (
        <TableStructureView
          tabId={tab.id}
          connectionId={tab.connectionId!}
          target={tab.browseTarget!}
          onBackToData={() => setViewMode(tab.id, 'data')}
        />
      ) : (
        <PanelGroup direction="vertical" autoSaveId="dbforge-editor-split">
          <Panel defaultSize={45} minSize={20}>
            <div className="pane-editor">
              <SqlEditor
                tabId={tab.id}
                doc={tab.sql}
                connectionId={tab.connectionId}
                fontSize={13}
                readOnly={false}
                errorPosition={tab.error?.position}
                onChange={(doc) => setSql(tab.id, doc, true)}
                onExecute={(mode) => void run(tab.id, mode)}
              />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-h" />
          <Panel defaultSize={55} minSize={20}>
            <div className="pane-result">
              <ResultTable
                tab={tab}
                readOnly={readOnly}
                onLoadMore={() => void loadMore(tab.id)}
                onApplyEdit={(rk, col, oldV, newV, pk) => applyEdit(tab.id, rk, col, oldV, newV, pk)}
                onSaveEdits={() => void saveEdits(tab.id)}
                onDiscardEdits={() => discardEdits(tab.id)}
                onExport={(fmt) => void exportResult(tab.id, fmt)}
              />
            </div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
