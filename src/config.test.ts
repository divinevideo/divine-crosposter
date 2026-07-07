import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import type { Env } from './types'

function expectThrowStatus(fn: () => unknown, status: number): void {
  try {
    fn()
    throw new Error('expected function to throw')
  } catch (error) {
    expect(error).toMatchObject({ status })
  }
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CROSSPOST_QUEUE: {} as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://keycast.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video/oauth',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ...overrides,
  }
}

describe('loadConfig', () => {
  it('normalizes required URLs and feature flags', () => {
    const config = loadConfig(
      env({
        KEYCAST_URL: 'https://keycast.divine.video/',
        FUNNELCAKE_URL: 'https://api.divine.video/',
        OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video/oauth/',
        ENABLE_TIKTOK: 'true',
        ENABLE_X: 'false',
      }),
    )

    expect(config.keycastUrl).toBe('https://keycast.divine.video')
    expect(config.funnelcakeUrl).toBe('https://api.divine.video')
    expect(config.oauthRedirectBase).toBe('https://crossposter.divine.video/oauth')
    expect(config.features).toMatchObject({ instagram: false, tiktok: true, x: false, youtube: false })
  })

  it('requires required URLs and sufficiently long token encryption key material', () => {
    expectThrowStatus(() => loadConfig(env({ KEYCAST_URL: '' })), 500)
    expectThrowStatus(() => loadConfig(env({ TOKEN_ENCRYPTION_KEY: 'short' })), 500)
  })
})
