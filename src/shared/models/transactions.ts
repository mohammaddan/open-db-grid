export type TransactionState = 'none' | 'open'

import type { QueryErrorInfo } from './result'

export interface TransactionStatus {
  connectionId: string
  state: TransactionState
  /** timestamp when BEGIN was issued (when open) */
  startedAt?: number
}

export interface BeginTransactionResult {
  ok: boolean
  error?: QueryErrorInfo
}