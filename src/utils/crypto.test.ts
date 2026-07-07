import { describe, expect, it } from 'vitest'
import { decryptToken, encryptToken, generatePKCE, generateRandomId } from './crypto'

const KEY_MATERIAL = '0123456789abcdef0123456789abcdef'

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

describe('crypto helpers', () => {
  it('generates url-safe random ids', () => {
    const first = generateRandomId(16)
    const second = generateRandomId(16)

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first).not.toBe(second)
  })

  it('generates PKCE verifier and SHA-256 challenge', async () => {
    const pkce = await generatePKCE()

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(pkce.challenge).toBe(await sha256Base64Url(pkce.verifier))
  })

  it('encrypts tokens without plaintext and decrypts them with the same key material', async () => {
    const plaintext = 'platform-access-token-secret'

    const ciphertext = await encryptToken(plaintext, KEY_MATERIAL)

    expect(ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(ciphertext).not.toContain(plaintext)
    await expect(decryptToken(ciphertext, KEY_MATERIAL)).resolves.toBe(plaintext)
  })

  it('rejects short encryption key material and malformed ciphertext', async () => {
    await expect(encryptToken('secret', 'short')).rejects.toThrow('TOKEN_ENCRYPTION_KEY')
    await expect(decryptToken('not-v1', KEY_MATERIAL)).rejects.toThrow('invalid ciphertext')
  })
})
