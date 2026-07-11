import { describe, expect, it } from 'vitest'
import { app } from './index'
import type { Env } from './types'

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CROSSPOST_QUEUE: {} as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://keycast.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ...overrides,
  }
}

describe('health route', () => {
  it('returns branded service UI at root', async () => {
    const res = await app.request('/', {}, env())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('<title>Divine Crossposter</title>')
    expect(html).toContain('https://about.divine.video/wp-content/uploads/2026/01/diVine-3D-512.webp')
    expect(html).toContain('https://about.divine.video/wp-content/uploads/2025/11/Divine-Logo-Green.svg')
    expect(html).toContain('alt="Divine"')
    expect(html).toContain('<span class="service-name">Crossposter</span>')
    expect(html).not.toContain('di<span>V</span>ine Crossposter')
    expect(html).toContain('Send your loops farther.')
    expect(html).toContain('No slop. All human.')
    expect(html).toContain('Login with Divine')
    expect(html).toContain('Sign in with your Divine/Nostr account')
    expect(html).toContain('id="connect-list"')
    expect(html).toContain('id="preference-list"')
    expect(html).toContain("const KEYCAST_CLIENT_ID = 'Divine Crossposter';")
    expect(html).not.toContain("const KEYCAST_CLIENT_ID = 'Divine Identity Verification';")
    expect(html).toContain('function renderAuthControls()')
    expect(html).toContain("toggleAttribute('hidden', signedIn)")
    expect(html).toContain("$('logout-button').toggleAttribute('hidden', !signedIn)")
    expect(html).toContain('function clearRejectedSession(response)')
    expect(html).toContain('clearRejectedSession(resp)')
    expect(html).not.toContain("url.searchParams.set('default_register', 'true')")
  })

  it('returns service health', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, service: 'divine-crossposter' })
  })
})
