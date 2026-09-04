import type { JsonStore } from '@main/persistence/Store'
import { DEFAULT_SETTINGS } from '@shared/models/settings'
import type { AppSettings } from '@shared/models/settings'
import type { AppData } from './AppData'

export class SettingsService {
  constructor(private readonly store: JsonStore<AppData>) {}

  get(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.store.data.settings }
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.store.data.settings = { ...this.get(), ...patch }
    await this.store.save()
    return this.get()
  }
}