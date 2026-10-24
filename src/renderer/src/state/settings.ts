import { create } from 'zustand'
import type { AppSettings } from '@shared/models/settings'
import { DEFAULT_SETTINGS } from '@shared/models/settings'
import type { ThemeName } from '@shared/models/settings'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  patch: (p: Partial<AppSettings>) => Promise<void>
  setTheme: (theme: ThemeName) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    try {
      const s = await window.api.settings.get()
      set({ settings: s, loaded: true })
      applyTheme(s.theme)
    } catch {
      set({ loaded: true })
    }
  },

  async patch(p) {
    const next = await window.api.settings.set(p)
    applyTheme(next.theme)
    set({ settings: next })
  },

  async setTheme(theme) {
    await get().patch({ theme } as Partial<AppSettings>)
  }
}))

export function applyTheme(theme: ThemeName): void {
  const norm = theme === 'dark' ? 'cyber-dark' : theme
  document.documentElement.dataset.theme = norm
}