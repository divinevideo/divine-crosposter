import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index'
import { listConnections, upsertConnection } from '../db/connections'
import { createOAuthState } from '../db/oauth-states'
import { getPreferences, setPreference } from '../db/preferences'
import { applyMigrations, connection, PUBKEY_A } from '../db/test-helpers'
import { decryptToken } from '../utils/crypto'
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

describe('connection routes', () => {
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

  it('starts a connection by authenticating, storing OAuth state, and returning an authorization URL', async () => {
    fetchMock.mockResolvedValueOnce(authResponse())

    const response = await app.request(
      '/connections/tiktok/start',
      {
        method: 'POST',
        headers: { authorization: 'Bearer keycast-token', 'content-type': 'application/json' },
        body: JSON.stringify({ returnUrl: 'https://divine.video/settings/crossposting' }),
      },
      testEnv(db),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { authorizationUrl: string; state: string }
    const authorizationUrl = new URL(body.authorizationUrl)
    expect(authorizationUrl.origin).toBe('https://www.tiktok.com')
    expect(authorizationUrl.searchParams.get('client_key')).toBe('tiktok-client')
    expect(authorizationUrl.searchParams.get('state')).toBe(body.state)
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://crossposter.divine.video/connections/tiktok/callback',
    )
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy()

    const stored = await db.prepare('SELECT * FROM oauth_states WHERE state_id = ?').bind(body.state).first<{
      pubkey: string
      platform: string
      code_verifier: string
      return_url: string
      created_at: number
      expires_at: number
    }>()
    expect(stored).toMatchObject({
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      return_url: 'https://divine.video/settings/crossposting',
      created_at: 1_783_382_400,
      expires_at: 1_783_383_000,
    })
    expect(stored?.code_verifier).toBeTruthy()
  })

  it('consumes callback state once, stores encrypted tokens, and creates a default manual preference', async () => {
    await createOAuthState(db, {
      stateId: 'state_once',
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      codeVerifier: 'pkce-verifier',
      returnUrl: 'https://divine.video/settings/crossposting?section=sharing',
      createdAt: 1_000,
      expiresAt: 1_783_383_000,
      metadataJson: '{}',
    })
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3_600,
          scope: 'user.info.basic,video.publish',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: { user: { open_id: 'account-1', display_name: 'Divine TikTok' } },
        }),
      )

    const response = await app.request(
      '/connections/tiktok/callback?code=oauth-code&state=state_once',
      {},
      testEnv(db),
    )
    const retry = await app.request('/connections/tiktok/callback?code=oauth-code&state=state_once', {}, testEnv(db))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://divine.video/settings/crossposting?section=sharing&connection=connected&platform=tiktok',
    )
    expect(retry.status).toBe(302)
    expect(retry.headers.get('location')).toBe(
      'https://crossposter.divine.video/?connection=failed&platform=tiktok',
    )

    const rows = await listConnections(db, PUBKEY_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      platform: 'tiktok',
      externalAccountId: 'account-1',
      externalAccountName: 'Divine TikTok',
      status: 'connected',
      grantedScopes: 'user.info.basic,video.publish',
    })
    expect(rows[0].encryptedAccessToken).not.toBe('access-token')
    await expect(decryptToken(rows[0].encryptedAccessToken, testEnv(db).TOKEN_ENCRYPTION_KEY)).resolves.toBe(
      'access-token',
    )
    await expect(decryptToken(rows[0].encryptedRefreshToken ?? '', testEnv(db).TOKEN_ENCRYPTION_KEY)).resolves.toBe(
      'refresh-token',
    )
    await expect(getPreferences(db, PUBKEY_A)).resolves.toMatchObject([
      { platform: 'tiktok', connectionId: rows[0].id, mode: 'manual', automaticEnabledAt: null },
    ])
  })

  it('redirects failed callbacks for expired state without storing a connection', async () => {
    await createOAuthState(db, {
      stateId: 'state_expired',
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      codeVerifier: 'pkce-verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 1_100,
      metadataJson: '{}',
    })

    const response = await app.request(
      '/connections/tiktok/callback?code=oauth-code&state=state_expired',
      {},
      testEnv(db),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://crossposter.divine.video/?connection=failed&platform=tiktok',
    )
    await expect(listConnections(db, PUBKEY_A)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists connections without encrypted token fields', async () => {
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
    fetchMock.mockResolvedValueOnce(authResponse())

    const response = await app.request(
      '/connections',
      { headers: { authorization: 'Bearer keycast-token' } },
      testEnv(db),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { connections: Array<Record<string, unknown>> }
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0]).toMatchObject({
      id: 'conn_tiktok',
      platform: 'tiktok',
      externalAccountId: 'external-account-1',
      externalAccountName: '@divine',
      status: 'connected',
    })
    expect(body.connections[0]).not.toHaveProperty('encryptedAccessToken')
    expect(body.connections[0]).not.toHaveProperty('encryptedRefreshToken')
    expect(body.connections[0]).not.toHaveProperty('metadataJson')
  })

  it('reconnect after disconnect restores the default manual preference', async () => {
    await upsertConnection(db, connection({ id: 'conn_old', status: 'disconnected' }))
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: null,
      mode: 'disabled',
      automaticEnabledAt: null,
      createdAt: 1_000,
      updatedAt: 1_500,
    })
    await createOAuthState(db, {
      stateId: 'state_reconnect',
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      codeVerifier: 'pkce-verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 1_783_383_000,
      metadataJson: '{}',
    })
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', refresh_token: 'refresh-token' }))
      .mockResolvedValueOnce(Response.json({ data: { user: { open_id: 'external-account-1', display_name: 'Divine TikTok' } } }))

    const response = await app.request(
      '/connections/tiktok/callback?code=oauth-code&state=state_reconnect',
      {},
      testEnv(db),
    )

    expect(response.status).toBe(302)
    await expect(getPreferences(db, PUBKEY_A)).resolves.toMatchObject([
      { platform: 'tiktok', mode: 'manual', connectionId: 'conn_old', automaticEnabledAt: null },
    ])
  })

  it('disconnects owned connections and disables the matching preference', async () => {
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
    fetchMock.mockResolvedValueOnce(authResponse())

    const response = await app.request(
      '/connections/tiktok/conn_tiktok',
      { method: 'DELETE', headers: { authorization: 'Bearer keycast-token' } },
      testEnv(db),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ disconnected: true })
    await expect(listConnections(db, PUBKEY_A)).resolves.toMatchObject([{ id: 'conn_tiktok', status: 'disconnected' }])
    await expect(getPreferences(db, PUBKEY_A)).resolves.toMatchObject([
      { platform: 'tiktok', connectionId: null, mode: 'disabled', automaticEnabledAt: null },
    ])
  })
})
