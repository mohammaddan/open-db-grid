import { useState, useRef, useEffect } from 'react'
import { ShieldCheck, Palette, Check } from 'lucide-react'
import { useConnectionsStore } from '@renderer/state/connections'
import { useEditorStore } from '@renderer/state/editor'
import { useSettingsStore } from '@renderer/state/settings'
import { AVAILABLE_THEMES } from '@shared/models/settings'

function formatRows(n: number | undefined): string {
  return n === undefined ? '' : n.toLocaleString('en-US')
}

export function StatusBar(): JSX.Element {
  const openInfo = useConnectionsStore((s) => s.openInfo)
  const selectedId = useConnectionsStore((s) => s.selectedId)
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const txnState = useEditorStore((s) => s.txnState)
  const theme = useSettingsStore((s) => s.settings.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Close theme picker when clicking outside
  useEffect(() => {
    if (!themePickerOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [themePickerOpen])

  const connId = activeTab?.connectionId ?? selectedId
  const info = connId ? openInfo[connId] : undefined
  const conn = useConnectionsStore((s) => s.connections.find((c) => c.id === connId))
  const txn = connId ? txnState[connId] : undefined

  const result = activeTab?.result
  const page = result?.page
  const fetched = page?.fetched ?? page?.rows?.length
  const totalRows = result?.totalRows ?? page?.totalRows
  const hasMore = activeTab?.hasMore ?? page?.hasMore ?? false
  const rowsAffected = result?.rowsAffected
  const duration = result?.durationMs

  const rowsDisplay = (() => {
    if (result?.kind === 'DML' && rowsAffected !== undefined) {
      return {
        text: `${formatRows(rowsAffected)} ${rowsAffected === 1 ? 'row' : 'rows'} affected`,
        title: `${formatRows(rowsAffected)} rows affected by statement`
      }
    }
    if (totalRows !== undefined) {
      if (hasMore && fetched !== undefined && fetched < totalRows) {
        return {
          text: `${formatRows(totalRows)} rows (${formatRows(fetched)} loaded)`,
          title: `Total: ${formatRows(totalRows)} query result rows (${formatRows(fetched)} loaded in memory)`
        }
      }
      return {
        text: `${formatRows(totalRows)} rows`,
        title: `${formatRows(totalRows)} total result rows`
      }
    }
    if (fetched !== undefined) {
      if (hasMore) {
        return {
          text: `${formatRows(fetched)}+ rows`,
          title: `${formatRows(fetched)} rows loaded (more rows available)`
        }
      }
      return {
        text: `${formatRows(fetched)} rows`,
        title: `${formatRows(fetched)} result rows`
      }
    }
    return null
  })()

  const currentTheme =
    AVAILABLE_THEMES.find((t) => t.id === theme) ??
    AVAILABLE_THEMES.find((t) => t.id === 'cyber-dark') ??
    AVAILABLE_THEMES[0]

  return (
    <div className="statusbar">
      <span className="status-item">
        {info ? (
          <>
            <span
              className="dot"
              style={{
                background: conn ? colorDot(conn.id) : 'var(--accent)',
                boxShadow: `0 0 6px ${conn ? colorDot(conn.id) : 'var(--accent)'}`
              }}
            />
            <strong style={{ color: 'var(--fg)' }}>{conn?.name}</strong>
            {info.serverVersion ? (
              <span style={{ color: 'var(--fg-dim)' }}>· PG {info.serverVersion.split(' ')[1] ?? info.serverVersion}</span>
            ) : ''}
          </>
        ) : conn ? (
          <>
            <span className="dot" style={{ background: 'var(--fg-dim)' }} />
            {conn.name} <span style={{ color: 'var(--fg-dim)' }}>(disconnected)</span>
          </>
        ) : (
          <span style={{ color: 'var(--fg-dim)' }}>No active connection</span>
        )}
      </span>

      {conn?.accessMode === 'read-only' && (
        <span className="status-item readonly" title="Read-only mode active: writing is blocked at the engine level">
          <ShieldCheck size={12} /> READ ONLY
        </span>
      )}
      {conn?.production && <span className="status-item prod">PRODUCTION</span>}
      {txn === 'open' && <span className="status-item txn">● IN TRANSACTION</span>}

      <span className="spacer" />

      {activeTab?.running && <span className="status-item running">● Executing Query…</span>}
      {rowsDisplay && (
        <span className="status-item" style={{ fontFamily: 'var(--font-mono)' }} title={rowsDisplay.title}>
          {rowsDisplay.text}
        </span>
      )}
      {duration !== undefined && (
        <span className="status-item" style={{ fontFamily: 'var(--font-mono)' }} title={`Execution duration: ${duration} ms`}>
          {duration} ms
        </span>
      )}

      {/* Theme Selector Popover */}
      <div className="theme-picker-container" ref={popoverRef}>
        <button
          className={'status-item theme-toggle' + (themePickerOpen ? ' active' : '')}
          title="Select theme palette"
          onClick={() => setThemePickerOpen((v) => !v)}
        >
          <span
            className="theme-swatch-dot"
            style={{
              backgroundColor: currentTheme.accentColor,
              boxShadow: `0 0 5px ${currentTheme.accentColor}`
            }}
          />
          <Palette size={12} />
          <span>{currentTheme.name}</span>
        </button>

        {themePickerOpen && (
          <div className="theme-popover">
            <div className="theme-popover-header">
              <span>Color Themes</span>
              <span style={{ fontSize: 10, color: 'var(--fg-dim)' }}>{AVAILABLE_THEMES.length} themes</span>
            </div>
            {AVAILABLE_THEMES.map((th) => {
              const isSelected =
                theme === th.id || (theme === 'dark' && th.id === 'cyber-dark')
              return (
                <button
                  key={th.id}
                  type="button"
                  className={'theme-option' + (isSelected ? ' active' : '')}
                  onClick={() => {
                    void setTheme(th.id)
                    setThemePickerOpen(false)
                  }}
                >
                  <div
                    className="theme-swatch"
                    style={{ backgroundColor: th.previewBg }}
                  >
                    <span
                      className="theme-swatch-dot"
                      style={{
                        backgroundColor: th.accentColor,
                        boxShadow: `0 0 6px ${th.accentColor}`
                      }}
                    />
                  </div>
                  <div className="theme-option-info">
                    <span className="theme-option-name">
                      {th.name}
                      <span
                        style={{
                          fontSize: 9.5,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--fg-dim)',
                          marginLeft: 'auto'
                        }}
                      >
                        {th.category}
                      </span>
                    </span>
                    <span className="theme-option-desc">{th.description}</span>
                  </div>
                  {isSelected && <Check size={14} className="theme-option-check" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** color lookup helper */
function colorDot(connectionId: string): string {
  const conn = useConnectionsStore
    .getState()
    .connections.find((c) => c.id === connectionId)
  if (!conn) return 'var(--accent)'
  const palette: Record<string, string> = {
    slate: '#94a3b8',
    red: '#f43f5e',
    orange: '#fb923c',
    amber: '#f59e0b',
    green: '#10b981',
    teal: '#06b6d4',
    blue: '#38bdf8',
    purple: '#8b5cf6',
    pink: '#ec4899'
  }
  return palette[conn.color] ?? palette.slate
}
