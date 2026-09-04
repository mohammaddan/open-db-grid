// Credential storage abstraction.
//
// Passwords are stored via the OS credential/keychain mechanism through
// Electron safeStorage (Keychain on macOS, DPAPI on Windows, libsecret on
// Linux). If safeStorage is unavailable we fall back to an in-memory store so
// secrets are NEVER persisted in plain text.
//
// Design: an application-scoped AES-256-GCM key is generated once, wrapped
// (encrypted) by safeStorage and persisted in the store file. Individual
// secrets are then encrypted with that application key + a random IV per
// secret. Rotating the app key re-encrypts nothing — both evolve together.

import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import {
  encryptWithKey,
  decryptWithKey,
  type StoredSecret,
  type PersistedSecrets,
  type WrappedKey
} from './secretCrypto'

export { encryptWithKey, decryptWithKey } from './secretCrypto'
export type { StoredSecret, PersistedSecrets, WrappedKey } from './secretCrypto'

export interface CredentialStoreLike {
  readonly available: boolean
  readonly kindName: string
  loadPersisted(secrets: PersistedSecrets): void
  toPersisted(): PersistedSecrets
  /** generate/refresh the wrapped application key; returns stored blob or null */
  initKey(): WrappedKey | null
  put(secret: string, id?: string): Promise<string>
  get(id: string): Promise<string | null>
  delete(id: string): Promise<void>
}

/**
 * Credential store backed by Electron safeStorage (application AES key
 * wrapped by the OS keychain). Falls back to memory-only when unavailable.
 */
export class CredentialStore implements CredentialStoreLike {
  readonly available: boolean
  readonly kindName: string
  /** application AES-256 key (raw, memory only) */
  private appKey: Buffer | null = null
  /** id -> plaintext (decrypted; memory only) */
  private blobs = new Map<string, string>()
  /** id -> encrypted blob (what gets written to disk) */
  private persisted = new Map<string, StoredSecret>()
  private keyWrapped: string | null = null

  constructor(savedKeyBlob: WrappedKey | null) {
    this.available = safeStorage.isEncryptionAvailable()
    this.kindName = this.available ? 'safeStorage' : 'memory-only'
    if (this.available && savedKeyBlob) {
      this.keyWrapped = savedKeyBlob.wrapped
      try {
        // the wrapped payload is the base64 text of the raw 32-byte key
        const plain = safeStorage.decryptString(Buffer.from(savedKeyBlob.wrapped, 'base64'))
        this.appKey = Buffer.from(plain, 'base64')
      } catch {
        this.appKey = null
      }
    }
  }

  initKey(): WrappedKey | null {
    if (!this.available) return null
    if (this.appKey && this.keyWrapped) return { wrapped: this.keyWrapped }
    const key = randomBytes(32)
    this.appKey = key
    // safeStorage encrypts STRINGS: wrap the base64 text of the raw key
    const wrapped = safeStorage.encryptString(key.toString('base64')).toString('base64')
    this.keyWrapped = wrapped
    return { wrapped }
  }

  loadPersisted(secrets: PersistedSecrets): void {
    for (const [id, blob] of Object.entries(secrets)) {
      this.persisted.set(id, blob)
      const plain = this.appKey ? decryptWithKey(blob, this.appKey) : null
      if (plain !== null) this.blobs.set(id, plain)
    }
  }

  toPersisted(): PersistedSecrets {
    return Object.fromEntries(this.persisted.entries())
  }

  async put(secret: string, id?: string): Promise<string> {
    const secretId = id ?? crypto.randomUUID()
    this.blobs.set(secretId, secret)
    if (this.appKey) {
      this.persisted.set(secretId, encryptWithKey(secret, this.appKey))
    }
    return secretId
  }

  async get(id: string): Promise<string | null> {
    return this.blobs.get(id) ?? null
  }

  async delete(id: string): Promise<void> {
    this.blobs.delete(id)
    this.persisted.delete(id)
  }
}

/** Creates a store honoring the saved key blob (persist file). */
export function createCredentialStore(savedKey: WrappedKey | null): CredentialStore {
  return new CredentialStore(savedKey)
}