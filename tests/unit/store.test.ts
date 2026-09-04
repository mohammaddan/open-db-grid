import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '@main/persistence/Store'

async function tempStore<T extends object>(defaults: () => T): Promise<{ store: JsonStore<T>; dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dbforge-store-'))
  const file = join(dir, 'app-store.json')
  return { store: new JsonStore<T>(file, defaults), dir, file }
}

describe('JsonStore', () => {
  it('creates defaults on first load and persists atomically', async () => {
    const { store, file } = await tempStore(() => ({ version: 1, items: [] as string[] }))
    const data = await store.load()
    expect(data.version).toBe(1)
    data.items.push('a')
    await store.save()
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.items).toEqual(['a'])
    expect(raw.version).toBe(1)
  })

  it('loads previously saved data back', async () => {
    const { store, file } = await tempStore(() => ({ version: 1, name: '' }))
    await store.load()
    await store.save({ name: 'hello' } as never)
    const second = new JsonStore<{ version: number; name: string }>(file, () => ({ version: 1, name: '' }))
    const reloaded = await second.load()
    expect(reloaded.name).toBe('hello')
  })

  it('deep-merges saved patches over defaults instead of replacing objects', async () => {
    const { store } = await tempStore(() => ({
      version: 1,
      nested: { a: 1, b: 2 }
    }))
    await store.load()
    await store.save({ nested: { b: 9 } } as never)
    expect(store.data.nested).toEqual({ a: 1, b: 9 })
  })

  it('quarantines corrupt files and starts fresh', async () => {
    const { store, file } = await tempStore(() => ({ version: 1, ok: true }))
    await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
    await writeFile(file, '{ this is not json')
    const data = await store.load()
    expect(data.version).toBe(1)
  })

  it('serializes concurrent saves through a write chain', async () => {
    const { store, file } = await tempStore(() => ({ version: 1, n: 0 }))
    await store.load()
    await Promise.all([
      store.save({ n: 1 } as never),
      store.save({ n: 2 } as never),
      store.save({ n: 3 } as never)
    ])
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.n).toBe(3)
  })
})
