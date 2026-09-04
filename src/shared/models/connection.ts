// Core models shared between the renderer UI and the main-process database layer.
// These are plain, serializable DTOs crossing the IPC boundary.

import type { QueryErrorInfo } from './result'

export type DatabaseEngine = 'postgresql'
export type ConnectionAccessMode = 'read-write' | 'read-only'

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export interface SslOptions {
  /** pg maps: disable → no SSL, prefer/require → ssl:true, verify-* → ssl:{rejectUnauthorized:true} */
  mode: SslMode
}

export interface SshTunnelConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  /** password for password auth (never persisted plaintext) */
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface PostgresConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  ssl: SslOptions
  connectTimeoutMs: number
  /** connection pool size (per session) */
  poolSize: number
  ssh?: SshTunnelConfig
  /** connection label reported to the server (application_name) */
  applicationName?: string
}

export interface DbConnection {
  id: string
  name: string
  driver: DatabaseEngine
  config: PostgresConnectionConfig
  accessMode: ConnectionAccessMode
  production: boolean
  /** id of a predefined color, see CONNECTION_COLORS; free-form ids supported for future custom colors */
  color: string
  tags: string[]
  /** parent group id, or null for the tree root */
  groupId: string | null
  /** sort order within the group (drag & drop) */
  order?: number
  /** reference into the secure credential store; password never stored in this object */
  secretId?: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export interface ConnectionGroup {
  id: string
  name: string
  parentId: string | null
  collapsed: boolean
  order: number
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export interface ConnectionColor {
  id: string
  label: string
  /** hex used for the sidebar dot / tab accent */
  value: string
}

/** Predefined palette. The model stores a color id only, so custom colors map cleanly later. */
export const CONNECTION_COLORS: ConnectionColor[] = [
  { id: 'slate', label: 'Slate', value: '#94a3b8' },
  { id: 'red', label: 'Red', value: '#ef4444' },
  { id: 'orange', label: 'Orange', value: '#f97316' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'teal', label: 'Teal', value: '#14b8a6' },
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'purple', label: 'Purple', value: '#a855f7' },
  { id: 'pink', label: 'Pink', value: '#ec4899' }
]

export function colorOf(id: string | undefined): ConnectionColor {
  return CONNECTION_COLORS.find((c) => c.id === id) ?? CONNECTION_COLORS[0]
}

// ---------------------------------------------------------------------------
// Safe (read-only) connection editing support
// ---------------------------------------------------------------------------

export interface StoredConnection extends DbConnection {
  secretId: string
}

/** Plaintext password payload used only transiently over IPC (never persisted at rest). */
export interface ConnectionSecretRequest {
  password?: string
}

export interface ConnectionTestRequest extends ConnectionSecretRequest {
  check: DbConnection
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs?: number
  serverVersion?: string
  connectedDatabase?: string
  error?: QueryErrorInfo
}

export interface ConnectionSaveRequest extends ConnectionSecretRequest {
  connection: DbConnection
}

export interface OpenConnectionInfo {
  connectionId: string
  engine: DatabaseEngine
  serverVersion?: string
  connectedAt: number
  readOnly: boolean
}