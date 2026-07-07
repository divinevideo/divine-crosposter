import { describe, expect, it } from 'vitest'
import {
  assertAllowedReturnUrl,
  isValidEventId,
  isValidHexPubkey,
  normalizePubkey,
  parsePlatform,
  parsePreferenceMode,
} from './validation'

const PUBKEY_UPPER = 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'
const PUBKEY_LOWER = PUBKEY_UPPER.toLowerCase()

function expectThrowStatus(fn: () => unknown, status: number): void {
  try {
    fn()
    throw new Error('expected function to throw')
  } catch (error) {
    expect(error).toMatchObject({ status })
  }
}

describe('validation helpers', () => {
  it('validates and normalizes full 64-character hex pubkeys without truncating', () => {
    expect(isValidHexPubkey(PUBKEY_LOWER)).toBe(true)
    expect(isValidHexPubkey(PUBKEY_UPPER)).toBe(true)
    expect(normalizePubkey(PUBKEY_UPPER)).toBe(PUBKEY_LOWER)
    expect(normalizePubkey(PUBKEY_UPPER)).toHaveLength(64)
  })

  it('rejects malformed pubkeys and event ids', () => {
    expect(isValidHexPubkey(PUBKEY_LOWER.slice(0, 63))).toBe(false)
    expect(isValidHexPubkey(`${PUBKEY_LOWER.slice(0, 63)}z`)).toBe(false)
    expect(() => normalizePubkey(PUBKEY_LOWER.slice(0, 63))).toThrow('invalid pubkey')

    expect(isValidEventId(PUBKEY_LOWER)).toBe(true)
    expect(isValidEventId(`${PUBKEY_LOWER.slice(0, 63)}g`)).toBe(false)
  })

  it('parses platform and preference mode values', () => {
    expect(parsePlatform('instagram')).toBe('instagram')
    expect(parsePlatform('tiktok')).toBe('tiktok')
    expect(parsePlatform('x')).toBe('x')
    expect(parsePlatform('youtube')).toBe('youtube')
    expectThrowStatus(() => parsePlatform('threads'), 400)

    expect(parsePreferenceMode('manual')).toBe('manual')
    expect(parsePreferenceMode('automatic')).toBe('automatic')
    expect(parsePreferenceMode('disabled')).toBe('disabled')
    expectThrowStatus(() => parsePreferenceMode('enabled'), 400)
  })

  it('allows only Divine, redirect-base, localhost, and loopback return URLs', () => {
    const redirectBase = 'https://crossposter.divine.video/oauth/callback'

    expect(assertAllowedReturnUrl('https://divine.video/settings/crossposting', redirectBase)).toBe(
      'https://divine.video/settings/crossposting',
    )
    expect(assertAllowedReturnUrl('https://www.divine.video/settings/crossposting', redirectBase)).toBe(
      'https://www.divine.video/settings/crossposting',
    )
    expect(assertAllowedReturnUrl('https://crossposter.divine.video/connected', redirectBase)).toBe(
      'https://crossposter.divine.video/connected',
    )
    expect(assertAllowedReturnUrl('http://localhost:8787/callback', redirectBase)).toBe(
      'http://localhost:8787/callback',
    )
    expect(assertAllowedReturnUrl('http://127.0.0.1:8787/callback', redirectBase)).toBe(
      'http://127.0.0.1:8787/callback',
    )

    expectThrowStatus(() => assertAllowedReturnUrl('https://evil.example/settings', redirectBase), 400)
    expectThrowStatus(() => assertAllowedReturnUrl('not a url', redirectBase), 400)
  })
})
