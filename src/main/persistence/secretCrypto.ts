// Pure secret-encryption helpers (no Electron imports) so they are unit
// testable and reusable by any credential-store implementation.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export interface StoredSecret {
  v: 1
  /** base64 ciphertext */
  data: string
  /** base64 iv */
  iv: string
  /** base64 auth tag */
  tag: string
}

export function encryptWithKey(plain: string, key: Buffer): StoredSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    data: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  }
}

export function decryptWithKey(blob: StoredSecret, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
    const dec = Buffer.concat([
      decipher.update(Buffer.from(blob.data, 'base64')),
      decipher.final()
    ])
    return dec.toString('utf8')
  } catch {
    return null
  }
}

/** Map of secretId -> encrypted blob, persisted inside the app store file. */
export type PersistedSecrets = Record<string, StoredSecret>

/** Wrapped application AES key, persisted alongside app data. */
export interface WrappedKey {
  /** safeStorage-encrypted 32-byte key (base64) */
  wrapped: string
}
