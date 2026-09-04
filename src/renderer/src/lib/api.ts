// Renderer-side convenience over window.api: normalizes main-process
// DatabaseError payloads into a display-friendly QueryErrorInfo.

import type { QueryErrorInfo } from '@shared/models/result'

export interface ApiErrorShape {
  message: string
  sqlState?: string
  detail?: string
  hint?: string
  position?: number
  code?: string
}

/** Extracts structured error information thrown over the IPC boundary. */
export function extractApiError(err: unknown): QueryErrorInfo {
  if (err && typeof err === 'object') {
    const e = err as ApiErrorShape
    if (typeof e.message === 'string') {
      return {
        message: e.message,
        sqlState: e.sqlState,
        detail: e.detail,
        hint: e.hint,
        position: e.position,
        code: e.code
      }
    }
  }
  if (err instanceof Error) {
    return { message: err.message }
  }
  return { message: String(err) }
}

export function errorMessage(err: unknown): string {
  return extractApiError(err).message
}