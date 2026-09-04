// Query history entry. Credentials never enter this model.

export interface HistoryEntry {
  id: string
  connectionId: string
  connectionName: string
  sql: string
  executedAt: number
  success: boolean
  kind: string
  durationMs?: number
  resultCount?: number
  errorMessage?: string
}

export interface SavedQuery {
  id: string
  name: string
  sql: string
  connectionId?: string
  createdAt: number
  updatedAt: number
}

export type RecentEntry = {
  connectionId: string
  lastUsedAt: number
}