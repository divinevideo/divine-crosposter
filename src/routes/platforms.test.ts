import { describe, expect, it } from 'vitest'
import { app } from '../index'
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

describe('platforms route', () => {
  it('returns all provider summaries with enabled status from env', async () => {
    const res = await app.request('/platforms', {}, env({
      ENABLE_TIKTOK: 'true',
      TIKTOK_CLIENT_KEY: 'tiktok-client',
      TIKTOK_CLIENT_SECRET: 'tiktok-secret',
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      platforms: [
        { platform: 'instagram', enabled: false, supportsAutomatic: true },
        { platform: 'tiktok', enabled: true, supportsAutomatic: true },
        { platform: 'x', enabled: false, supportsAutomatic: true },
        { platform: 'youtube', enabled: false, supportsAutomatic: true },
      ],
    })
  })
})
