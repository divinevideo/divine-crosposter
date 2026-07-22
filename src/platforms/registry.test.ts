import { describe, expect, it } from 'vitest'
import { getAdapter, getEnabledAdapters, getProviderSummaries } from './registry'
import type { Env } from '../types'

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

describe('platform registry', () => {
  it('returns disabled provider summaries for every supported platform', () => {
    expect(getProviderSummaries(env())).toEqual([
      { platform: 'instagram', enabled: false, supportsAutomatic: true },
      { platform: 'tiktok', enabled: false, supportsAutomatic: true },
      { platform: 'x', enabled: false, supportsAutomatic: true },
      { platform: 'youtube', enabled: false, supportsAutomatic: true },
    ])
  })

  it('returns adapters only when the feature flag and credentials are configured', () => {
    const adapters = getEnabledAdapters(
      env({
        ENABLE_INSTAGRAM: 'true',
        INSTAGRAM_CLIENT_ID: 'instagram-client',
        INSTAGRAM_CLIENT_SECRET: 'instagram-secret',
        ENABLE_TIKTOK: 'true',
        TIKTOK_CLIENT_KEY: 'tiktok-client',
        ENABLE_X: 'true',
        TWITTER_CLIENT_ID: 'x-client',
        TWITTER_CLIENT_SECRET: 'x-secret',
        ENABLE_YOUTUBE: 'true',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      }),
    )

    expect(adapters.map((adapter) => adapter.platform)).toEqual(['instagram', 'x', 'youtube'])
  })

  it('marks summary enabled only when the adapter can be constructed', () => {
    expect(
      getProviderSummaries(
        env({
          ENABLE_TIKTOK: 'true',
          TIKTOK_CLIENT_KEY: 'tiktok-client',
          TIKTOK_CLIENT_SECRET: 'tiktok-secret',
        }),
      ),
    ).toContainEqual({ platform: 'tiktok', enabled: true, supportsAutomatic: true })
  })

  it('constructs only the requested adapter without validating unrelated app configuration', () => {
    const adapter = getAdapter(
      env({
        KEYCAST_URL: '',
        FUNNELCAKE_URL: '',
        OAUTH_REDIRECT_BASE: '',
        TOKEN_ENCRYPTION_KEY: '',
        YOUTUBE_DEFAULT_PRIVACY_STATUS: 'friends',
        ENABLE_X: 'true',
        TWITTER_CLIENT_ID: 'x-client',
        TWITTER_CLIENT_SECRET: 'x-secret',
      }),
      'x',
    )

    expect(adapter?.platform).toBe('x')
  })

  it('validates YouTube privacy only when constructing YouTube', () => {
    expect(() =>
      getAdapter(
        env({
          ENABLE_YOUTUBE: 'true',
          GOOGLE_CLIENT_ID: 'google-client',
          GOOGLE_CLIENT_SECRET: 'google-secret',
          YOUTUBE_DEFAULT_PRIVACY_STATUS: 'friends',
        }),
        'youtube',
      ),
    ).toThrow()
  })
})
