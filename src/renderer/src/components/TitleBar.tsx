import { useState, useEffect } from 'react'
import { Minus, Square, Copy, X, Search } from 'lucide-react'
import { OpenDBGridLogo } from '@renderer/components/OpenDBGridLogo'
import { useConnectionsStore } from '@renderer/state/connections'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'

export function TitleBar(): JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const openPalette = useUiStore((s) => s.openPalette)
  const selectedId = useConnectionsStore((s) => s.selectedId)
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const connections = useConnectionsStore((s) => s.connections)
  const openInfo = useConnectionsStore((s) => s.openInfo)

  const connId = activeTab?.connectionId ?? selectedId
  const conn = connId ? connections.find((c) => c.id === connId) : undefined
  const isOpen = connId ? Boolean(openInfo[connId]) : false

  useEffect(() => {
    // Initial check
    void window.api.window.isMaximized().then(setIsMaximized).catch(() => undefined)

    // Listen for IPC window maximize events
    const unsub = window.api.window.onMaximizedChange((maximized) => {
      setIsMaximized(maximized)
    })

    // Also update on native resize event
    const onResize = () => {
      void window.api.window.isMaximized().then(setIsMaximized).catch(() => undefined)
    }
    window.addEventListener('resize', onResize)

    return () => {
      unsub()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const handleMinimize = () => {
    void window.api.window.minimize()
  }

  const handleMaximize = () => {
    void window.api.window.maximize().then(setIsMaximized)
  }

  const handleClose = () => {
    void window.api.window.close()
  }

  return (
    <div
      className="custom-titlebar"
      onDoubleClick={handleMaximize}
    >
      {/* Left: App Brand & Connection Badge */}
      <div className="titlebar-left">
        <div className="titlebar-brand">
          <OpenDBGridLogo size={16} className="titlebar-logo" />
          <span className="titlebar-title">OpenDBGrid</span>
        </div>
        {conn && (
          <div className="titlebar-conn-badge" title={`Active: ${conn.name} (${conn.config.database})`}>
            <span className={'conn-status-dot' + (isOpen ? ' online' : '')} />
            <span className="conn-name">{conn.name}</span>
            <span className="conn-db">[{conn.config.database}]</span>
          </div>
        )}
      </div>

      {/* Center: Command Center Search Pill */}
      <div className="titlebar-center">
        <button
          className="titlebar-search-pill"
          onClick={openPalette}
          title="Search commands, connections and objects (Ctrl+Shift+P)"
        >
          <Search size={11} className="search-icon" />
          <span className="search-text">Search commands & tables…</span>
          <span className="search-kbd">Ctrl+Shift+P</span>
        </button>
      </div>

      {/* Right: Custom Window Management Controls */}
      <div className="titlebar-right">
        <button
          className="window-control-btn minimize"
          title="Minimize"
          onClick={handleMinimize}
        >
          <Minus size={13} />
        </button>
        <button
          className="window-control-btn maximize"
          title={isMaximized ? 'Restore' : 'Maximize'}
          onClick={handleMaximize}
        >
          {isMaximized ? <Copy size={11} style={{ transform: 'rotate(180deg)' }} /> : <Square size={11} />}
        </button>
        <button
          className="window-control-btn close"
          title="Close"
          onClick={handleClose}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
