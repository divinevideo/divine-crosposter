import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index'
import { upsertConnection } from '../db/connections'
import { getPreferences, setPreference } from '../db/preferences'
import { applyMigrations, connection, PUBKEY_A } from '../db/test-helpers'
import type { Env } from '../types'

function testEnv(db: D1Database): Env {
  return {
    DB: db,
    CROSSPOST_QUEUE: {} as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://keycast.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ENABLE_TIKTOK: 'true',
    TIKTOK_CLIENT_KEY: 'tiktok-client',
    TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  }
}

function authResponse(): Response {
  return Response.json({ result: PUBKEY_A })
}

describe('preference routes', () => {
  let db: D1Database
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists authenticated preferences', async () => {
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'manual',
      automaticEnabledAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    fetchMock.mockResolvedValueOnce(authResponse())

    const response = await app.request('/preferences', { headers: { authorization: 'Bearer token' } }, testEnv(db))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      preferences: [
        {
          platform: 'tiktok',
          connectionId: 'conn_tiktok',
          mode: 'manual',
          automaticEnabledAt: null,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    })
  })

  it('requires a connected platform for automatic mode and stores automatic_enabled_at', async () => {
    fetchMock.mockResolvedValueOnce(authResponse())

    const missingConnection = await app.request(
      '/preferences/tiktok',
      {
        method: 'PUT',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'automatic' }),
      },
      testEnv(db),
    )

    expect(missingConnection.status).toBe(400)
    await expect(missingConnection.json()).resolves.toMatchObject({
      error: { code: 'not_connected' },
    })

    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
    fetchMock.mockResolvedValueOnce(authResponse())

    const connected = await app.request(
      '/preferences/tiktok',
      {
        method: 'PUT',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'automatic' }),
      },
      testEnv(db),
    )

    expect(connected.status).toBe(200)
    await expect(connected.json()).resolves.toEqual({
      preference: {
        platform: 'tiktok',
        connectionId: 'conn_tiktok',
        mode: 'automatic',
        automaticEnabledAt: 1_783_382_400,
        createdAt: 1_783_382_400,
        updatedAt: 1_783_382_400,
      },
    })
  })

  it('clears automatic_enabled_at when switching to manual or disabled', async () => {
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'automatic',
      automaticEnabledAt: 1_500,
      createdAt: 1_000,
      updatedAt: 1_500,
    })
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(authResponse())

    const manual = await app.request(
      '/preferences/tiktok',
      {
        method: 'PUT',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'manual' }),
      },
      testEnv(db),
    )
    const disabled = await app.request(
      '/preferences/tiktok',
      {
        method: 'PUT',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'disabled' }),
      },
      testEnv(db),
    )

    expect(manual.status).toBe(200)
    await expect(manual.json()).resolves.toMatchObject({
      preference: { mode: 'manual', connectionId: 'conn_tiktok', automaticEnabledAt: null },
    })
    expect(disabled.status).toBe(200)
    await expect(disabled.json()).resolves.toMatchObject({
      preference: { mode: 'disabled', connectionId: null, automaticEnabledAt: null },
    })
    await expect(getPreferences(db, PUBKEY_A)).resolves.toMatchObject([
      { platform: 'tiktok', mode: 'disabled', connectionId: null, automaticEnabledAt: null },
    ])
  })
})
