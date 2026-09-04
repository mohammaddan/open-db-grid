// Create / edit / test a PostgreSQL connection. The password is transient:
// it is sent once over IPC for save/test and never stored in renderer state
// beyond the form lifecycle.

import { useEffect, useMemo, useState } from 'react'
import type {
  DbConnection,
  SslMode,
  ConnectionTestResult
} from '@shared/models/connection'
import { CONNECTION_COLORS } from '@shared/models/connection'
import { useUiStore } from '@renderer/state/ui'
import { useConnectionsStore } from '@renderer/state/connections'

interface FormState {
  name: string
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: SslMode
  connectTimeoutMs: number
  poolSize: number
  useSsh: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshAuthType: 'password' | 'privateKey'
  sshPassword: string
  sshKeyPath: string
  accessMode: 'read-write' | 'read-only'
  production: boolean
  color: string
  tags: string
  groupId: string | null
}

function blankForm(): FormState {
  return {
    name: '',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: '',
    sslMode: 'prefer',
    connectTimeoutMs: 10000,
    poolSize: 5,
    useSsh: false,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshAuthType: 'password',
    sshPassword: '',
    sshKeyPath: '',
    accessMode: 'read-write',
    production: false,
    color: 'blue',
    tags: '',
    groupId: null
  }
}

function formFrom(conn: DbConnection): FormState {
  return {
    name: conn.name,
    host: conn.config.host,
    port: conn.config.port,
    database: conn.config.database,
    username: conn.config.username,
    password: '',
    sslMode: conn.config.ssl.mode,
    connectTimeoutMs: conn.config.connectTimeoutMs,
    poolSize: conn.config.poolSize,
    useSsh: conn.config.ssh?.enabled ?? false,
    sshHost: conn.config.ssh?.host ?? '',
    sshPort: conn.config.ssh?.port ?? 22,
    sshUsername: conn.config.ssh?.username ?? '',
    sshAuthType: conn.config.ssh?.authType ?? 'password',
    sshPassword: '',
    sshKeyPath: conn.config.ssh?.privateKeyPath ?? '',
    accessMode: conn.accessMode,
    production: conn.production,
    color: conn.color,
    tags: conn.tags.join(', '),
    groupId: conn.groupId
  }
}

function toConnection(form: FormState, existing: DbConnection | undefined): DbConnection {
  const now = Date.now()
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: form.name.trim() || `${form.database}@${form.host}`,
    driver: 'postgresql',
    config: {
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      username: form.username.trim(),
      ssl: { mode: form.sslMode },
      connectTimeoutMs: Number(form.connectTimeoutMs) || 10000,
      poolSize: Math.max(1, Number(form.poolSize) || 5),
      ssh: form.useSsh
        ? {
            enabled: true,
            host: form.sshHost.trim(),
            port: Number(form.sshPort) || 22,
            username: form.sshUsername.trim(),
            authType: form.sshAuthType,
            ...(form.sshAuthType === 'password' && form.sshPassword
              ? { password: form.sshPassword }
              : {}),
            ...(form.sshAuthType === 'privateKey' && form.sshKeyPath
              ? { privateKeyPath: form.sshKeyPath }
              : {})
          }
        : undefined,
      applicationName: 'DBForge'
    },
    accessMode: form.accessMode,
    production: form.production,
    color: form.color,
    tags: form.tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
      .filter((t, i, arr) => arr.indexOf(t) === i),
    groupId: form.groupId,
    order: existing?.order,
    secretId: existing?.secretId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt
  }
}

export function ConnectionFormDialog(): JSX.Element | null {
  const dialog = useUiStore((s) => s.connectionDialog)
  const closeDialog = useUiStore((s) => s.closeConnectionDialog)
  const connections = useConnectionsStore((s) => s.connections)
  const groups = useConnectionsStore((s) => s.groups)
  const { saveConnection, testConnection } = useConnectionsStore()

  const existing = useMemo(
    () => (dialog?.connectionId ? connections.find((c) => c.id === dialog.connectionId) : undefined),
    [dialog?.connectionId, connections]
  )

  const [form, setForm] = useState<FormState>(blankForm)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (dialog) {
      setForm(existing ? formFrom(existing) : blankForm())
      setTestResult(null)
    }
  }, [dialog, existing])

  if (!dialog) return null

  const patch = (p: Partial<FormState>): void => setForm((f) => ({ ...f, ...p }))
  const onProduction = (on: boolean): void =>
    patch({ production: on, color: on && !existing ? 'red' : form.color })

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await testConnection(toConnection(form, existing), form.password || undefined))
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await saveConnection(toConnection(form, existing), form.password || undefined)
      if (saved) closeDialog()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeDialog}>
      <div className="modal connection-form" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{existing ? 'Edit Connection' : 'New Connection'}</div>
        <div className="form-grid">
          <label>Name</label>
          <input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Main PostgreSQL" autoFocus />
          <label>Host</label>
          <input value={form.host} onChange={(e) => patch({ host: e.target.value })} />
          <label>Port</label>
          <input type="number" value={form.port} onChange={(e) => patch({ port: Number(e.target.value) })} />
          <label>Database</label>
          <input value={form.database} onChange={(e) => patch({ database: e.target.value })} />
          <label>Username</label>
          <input value={form.username} onChange={(e) => patch({ username: e.target.value })} />
          <label>Password</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => patch({ password: e.target.value })}
            placeholder={existing?.secretId ? '•••••••• (unchanged)' : ''}
          />
          <label>SSL mode</label>
          <select value={form.sslMode} onChange={(e) => patch({ sslMode: e.target.value as SslMode })}>
            <option value="disable">disable</option>
            <option value="prefer">prefer</option>
            <option value="require">require</option>
            <option value="verify-ca">verify-ca</option>
            <option value="verify-full">verify-full</option>
          </select>
          <label>Timeout (ms)</label>
          <input type="number" value={form.connectTimeoutMs} onChange={(e) => patch({ connectTimeoutMs: Number(e.target.value) })} />
          <label>Pool size</label>
          <input type="number" value={form.poolSize} onChange={(e) => patch({ poolSize: Number(e.target.value) })} />
          <label>Group</label>
          <select value={form.groupId ?? ''} onChange={(e) => patch({ groupId: e.target.value || null })}>
            <option value="">(root)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <label>Tags</label>
          <input value={form.tags} onChange={(e) => patch({ tags: e.target.value })} placeholder="production, critical" />
          <label>Color</label>
          <div className="color-row">
            {CONNECTION_COLORS.map((c) => (
              <button
                key={c.id}
                className={'color-dot' + (form.color === c.id ? ' selected' : '')}
                style={{ background: c.value }}
                title={c.label}
                onClick={() => patch({ color: c.id })}
              />
            ))}
          </div>
          <label>Access mode</label>
          <div className="check-row">
            <label className="check">
              <input
                type="checkbox"
                checked={form.accessMode === 'read-only'}
                onChange={(e) => patch({ accessMode: e.target.checked ? 'read-only' : 'read-write' })}
              />
              Read-only (enforced by the server)
            </label>
            <label className="check">
              <input type="checkbox" checked={form.production} onChange={(e) => onProduction(e.target.checked)} />
              Production connection
            </label>
          </div>
        </div>
        {form.useSsh && (
          <div className="ssh-inline">
            <label className="check">
              <input type="checkbox" checked={form.useSsh} onChange={(e) => patch({ useSsh: e.target.checked })} />
              SSH tunnel active
            </label>
            <div className="form-grid ssh-grid">
              <span>SSH host</span>
              <input value={form.sshHost} onChange={(e) => patch({ sshHost: e.target.value })} />
              <span>SSH port</span>
              <input type="number" value={form.sshPort} onChange={(e) => patch({ sshPort: Number(e.target.value) })} />
              <span>SSH user</span>
              <input value={form.sshUsername} onChange={(e) => patch({ sshUsername: e.target.value })} />
              <span>Auth</span>
              <select
                value={form.sshAuthType}
                onChange={(e) => patch({ sshAuthType: e.target.value as 'password' | 'privateKey' })}
              >
                <option value="password">Password</option>
                <option value="privateKey">Private key</option>
              </select>
              {form.sshAuthType === 'password' ? (
                <>
                  <span>SSH password</span>
                  <input type="password" value={form.sshPassword} onChange={(e) => patch({ sshPassword: e.target.value })} />
                </>
              ) : (
                <>
                  <span>Key path</span>
                  <input value={form.sshKeyPath} onChange={(e) => patch({ sshKeyPath: e.target.value })} placeholder="~/.ssh/id_rsa" />
                </>
              )}
            </div>
          </div>
        )}

        {testResult && (
          <div className={'test-result ' + (testResult.ok ? 'ok' : 'err')}>
            {testResult.ok
              ? `Connected · ${testResult.latencyMs ?? '?'} ms${testResult.serverVersion ? ' · ' + testResult.serverVersion : ''}`
              : `Failed: ${testResult.error?.message ?? 'unknown error'}`}
            {testResult.error?.hint && <div className="hint">{testResult.error.hint}</div>}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={closeDialog}>Cancel</button>
          <button className="btn primary" disabled={saving || !form.database.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

