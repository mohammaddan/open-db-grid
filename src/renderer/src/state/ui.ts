import { create } from 'zustand'
import type { QueryErrorInfo } from '@shared/models/result'

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

export interface ConfirmRequest {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
}

export interface PromptRequest {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
}

interface UiState {
  paletteOpen: boolean
  historyOpen: boolean
  savedOpen: boolean
  confirm: ConfirmRequest | null
  prompt: PromptRequest | null
  toasts: Toast[]
  connectionDialog: { connectionId: string | null } | null

  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
  openHistory: () => void
  closeHistory: () => void
  toggleHistory: () => void
  openSaved: () => void
  closeSaved: () => void
  requestConfirm: (req: ConfirmRequest) => void
  dismissConfirm: () => void
  requestPrompt: (req: PromptRequest) => void
  dismissPrompt: () => void
  pushToast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  openConnectionDialog: (connectionId: string | null) => void
  closeConnectionDialog: () => void
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  historyOpen: false,
  savedOpen: false,
  confirm: null,
  prompt: null,
  toasts: [],
  connectionDialog: null,

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
  openSaved: () => set({ savedOpen: true }),
  closeSaved: () => set({ savedOpen: false }),
  requestConfirm: (req) => set({ confirm: req }),
  dismissConfirm: () => set({ confirm: null }),
  requestPrompt: (req) => set({ prompt: req }),
  dismissPrompt: () => set({ prompt: null }),
  pushToast: (kind, text) => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openConnectionDialog: (connectionId) => set({ connectionDialog: { connectionId } }),
  closeConnectionDialog: () => set({ connectionDialog: null })
}))

export function toastFromError(err: unknown): QueryErrorInfo {
  const info =
    err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)
      ? (err as unknown as QueryErrorInfo)
      : { message: String(err) }
  return info
}