// Atomic JSON persistence for application state (connections, groups, history,
// saved queries, settings). Writes go to a temp file + rename so a crash never
// corrupts the app store.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export class JsonStore<T extends object> {
  private cache: T | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly defaults: () => T
  ) {}

  async load(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as T
      this.cache = { ...this.defaults(), ...parsed }
      this.cache = this.deepMerge(this.defaults(), this.cache) as T
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.cache = this.defaults()
      } else {
        try {
          await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
        } catch {
          /* ignore */
        }
        console.warn('[store] corrupted app data, starting fresh:', err.message)
        this.cache = this.defaults()
      }
    }
    return this.cache
  }

  get data(): T {
    if (!this.cache) throw new Error('store not loaded')
    return this.cache
  }

  async save(patch?: Partial<T>): Promise<T> {
    if (!this.cache) throw new Error('store not loaded')
    if (patch) this.cache = this.deepMerge(this.cache, patch) as T
    const snapshot = JSON.stringify(this.cache, null, 2)
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, this.filePath)
    })
    await this.writeChain
    return this.cache
  }

  private deepMerge(base: unknown, override: unknown): unknown {
    if (Array.isArray(base) || Array.isArray(override)) return override
    if (
      typeof base === 'object' &&
      base !== null &&
      typeof override === 'object' &&
      override !== null
    ) {
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
      for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
        out[k] = this.deepMerge(out[k], v)
      }
      return out
    }
    return override ?? base
  }
}

export function storeFilePath(userDataDir: string): string {
  return join(userDataDir, 'app-store.json')
}

/** Simple helper to write a whole file atomically. */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, filePath)
}

export async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}