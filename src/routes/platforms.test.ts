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
  it('returns a branded provider status page by default', async () => {
    const res = await app.request(
      '/platforms',
      {
        headers: { accept: 'text/html' },
      },
      env({
        ENABLE_TIKTOK: 'true',
        TIKTOK_CLIENT_KEY: 'tiktok-client',
        TIKTOK_CLIENT_SECRET: 'tiktok-secret',
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('<title>Divine Crossposter Platforms</title>')
    expect(html).toContain('di<span>V</span>ine Crossposter')
    expect(html).toContain('Provider status')
    expect(html).toContain('TikTok')
    expect(html).toContain('Ready')
    expect(html).toContain('Waiting on keys')
    expect(html).toContain('Back to setup')
  })

  it('returns all provider summaries as JSON when requested', async () => {
    const res = await app.request(
      '/platforms',
      {
        headers: { accept: 'application/json' },
      },
      env({
        ENABLE_TIKTOK: 'true',
        TIKTOK_CLIENT_KEY: 'tiktok-client',
        TIKTOK_CLIENT_SECRET: 'tiktok-secret',
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    await expect(res.json()).resolves.toEqual({
      platforms: [
        { platform: 'instagram', enabled: false, supportsAutomatic: true },
        { platform: 'tiktok', enabled: true, supportsAutomatic: true },
        { platform: 'x', enabled: false, supportsAutomatic: true },
        { platform: 'youtube', enabled: false, supportsAutomatic: true },
      ],
    })
  })

  it('returns JSON for format=json', async () => {
    const res = await app.request('/platforms?format=json', {}, env())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
