// The full application store shape. One JSON file, atomic writes.
// Credentials live as encrypted blobs (see CredentialStore), never plaintext.

import type { DbConnection, ConnectionGroup } from '@shared/models/connection'
import type { HistoryEntry, SavedQuery, RecentEntry } from '@shared/models/history'
import { DEFAULT_SETTINGS } from '@shared/models/settings'
import type { AppSettings } from '@shared/models/settings'
import type { PersistedSecrets } from '@main/persistence/CredentialStore'

export interface AppData {
  version: number
  /** wrapped safeStorage AES key */
  key?: { wrapped: string }
  credentials: PersistedSecrets
  connections: DbConnection[]
  groups: ConnectionGroup[]
  /** keyed by connectionId */
  history: Record<string, HistoryEntry[]>
  savedQueries: SavedQuery[]
  settings: AppSettings
  recents: RecentEntry[]
}

export function defaultAppData(): AppData {
  return {
    version: 1,
    credentials: {},
    connections: [],
    groups: [],
    history: {},
    savedQueries: [],
    settings: { ...DEFAULT_SETTINGS },
    recents: []
  }
}

export const HISTORY_PER_CONNECTION_LIMIT = 500