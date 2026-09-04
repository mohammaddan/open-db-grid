import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptWithKey, decryptWithKey } from '@main/persistence/secretCrypto'

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const key = randomBytes(32)
    const blob = encryptWithKey('hunter2', key)
    expect(blob.v).toBe(1)
    expect(blob.data).not.toContain('hunter2')
    expect(decryptWithKey(blob, key)).toBe('hunter2')
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const key = randomBytes(32)
    const a = encryptWithKey('same', key)
    const b = encryptWithKey('same', key)
    expect(a.data).not.toBe(b.data)
    expect(a.iv).not.toBe(b.iv)
  })

  it('fails closed on the wrong key or tampered ciphertext', () => {
    const blob = encryptWithKey('secret', randomBytes(32))
    expect(decryptWithKey(blob, randomBytes(32))).toBeNull()
    const tampered = { ...blob, data: Buffer.from('garbage').toString('base64') }
    expect(decryptWithKey(tampered, randomBytes(32))).toBeNull()
  })
})
