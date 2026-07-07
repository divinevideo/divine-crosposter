import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listAttempts } from '../db/attempts'
import { getConnection, upsertConnection } from '../db/connections'
import { createOrGetJob, getJob } from '../db/jobs'
import { applyMigrations, connection, job, PUBKEY_A } from '../db/test-helpers'
import type { Env, Platform } from '../types'
import { encryptToken } from '../utils/crypto'
import { processCrosspostJob, PublisherRetryError } from './publisher'

const KEY = '0123456789abcdef0123456789abcdef'

function env(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CROSSPOST_QUEUE: {} as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://keycast.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video/oauth',
    TOKEN_ENCRYPTION_KEY: KEY,
    ...overrides,
  }
}

function platformEnv(db: D1Database, platform: Platform): Env {
  const base = env(db)
  switch (platform) {
    case 'instagram':
      return {
        ...base,
        ENABLE_INSTAGRAM: 'true',
        INSTAGRAM_CLIENT_ID: 'instagram-client',
        INSTAGRAM_CLIENT_SECRET: 'instagram-secret',
      }
    case 'tiktok':
      return {
        ...base,
        ENABLE_TIKTOK: 'true',
        TIKTOK_CLIENT_KEY: 'tiktok-client',
        TIKTOK_CLIENT_SECRET: 'tiktok-secret',
      }
    case 'x':
      return {
        ...base,
        ENABLE_X: 'true',
        TWITTER_CLIENT_ID: 'x-client',
        TWITTER_CLIENT_SECRET: 'x-secret',
      }
    case 'youtube':
      return {
        ...base,
        ENABLE_YOUTUBE: 'true',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      }
  }
}

async function seedConnectedJob(db: D1Database, platform: Platform, overrides: Parameters<typeof job>[0] = {}) {
  const encryptedAccessToken = await encryptToken('access-token', KEY)
  await upsertConnection(
    db,
    connection({
      id: 'conn_1',
      platform,
      encryptedAccessToken,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      externalAccountId: 'external-account-1',
    }),
  )
  const created = await createOrGetJob(db, job({ id: 'job_1', platform, ...overrides }))
  return created.job
}

describe('publisher service', () => {
  let db: D1Database
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('marks a successful publish as posted and records an attempt', async () => {
    await seedConnectedJob(db, 'instagram')
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id', permalink: 'https://instagram.example/reel' }))

    await expect(processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'posted',
    })

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'ig-post-id',
      externalPostUrl: 'https://instagram.example/reel',
      errorCode: null,
    })
    await expect(listAttempts(db, 'job_1')).resolves.toEqual([
      expect.objectContaining({ status: 'posted', errorCode: null }),
    ])
  })

  it('records processing state and schedules a retry', async () => {
    await seedConnectedJob(db, 'tiktok')
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { privacy_level_options: ['SELF_ONLY'] } }))
      .mockResolvedValueOnce(Response.json({ data: { publish_id: 'publish-id' }, error: { code: 'ok' } }))

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'processing',
      retryDelaySeconds: 60,
    })

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'processing',
      externalPostId: 'publish-id',
      nextRetryAt: 2_060,
    })
    await expect(listAttempts(db, 'job_1')).resolves.toEqual([
      expect.objectContaining({ status: 'processing', providerResponseJson: expect.stringContaining('publish-id') }),
    ])
  })

  it('claims queued jobs atomically so duplicate delivery does not publish twice', async () => {
    await seedConnectedJob(db, 'instagram')
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id' }))

    const results = await Promise.all([
      processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 }),
      processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 }),
    ])

    expect(results).toContainEqual({ status: 'posted' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(listAttempts(db, 'job_1')).resolves.toHaveLength(1)
  })

  it('polls a processing job and marks it posted when the platform is complete', async () => {
    await seedConnectedJob(db, 'tiktok', {
      status: 'processing',
      externalPostId: 'publish-id',
      nextRetryAt: 2_000,
    })
    await listAttempts(db, 'job_1')
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { status: 'PUBLISH_COMPLETE', publish_id: 'publish-id' }, error: { code: 'ok' } }),
    )

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'posted',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ publish_id: 'publish-id' })
    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({ status: 'posted' })
  })

  it('caps repeated processing polls with processing_timeout', async () => {
    await seedConnectedJob(db, 'tiktok', {
      status: 'processing',
      externalPostId: 'publish-id',
      nextRetryAt: 2_000,
      retryCount: 5,
    })
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { status: 'PROCESSING_UPLOAD', publish_id: 'publish-id' }, error: { code: 'ok' } }),
    )

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'failed',
    })

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'failed',
      retryCount: 6,
      errorCode: 'processing_timeout',
      nextRetryAt: null,
    })
  })

  it('keeps processing jobs in poll mode after transient poll failures', async () => {
    await seedConnectedJob(db, 'tiktok', {
      status: 'processing',
      externalPostId: 'publish-id',
      nextRetryAt: 2_000,
    })
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'slow down' } }, { status: 429 }))

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).rejects.toBeInstanceOf(
      PublisherRetryError,
    )
    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'processing',
      retryCount: 1,
      errorCode: 'processing_timeout',
      nextRetryAt: 2_060,
    })

    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { status: 'PUBLISH_COMPLETE', publish_id: 'publish-id' }, error: { code: 'ok' } }),
    )
    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_060 })).resolves.toEqual({
      status: 'posted',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/')
  })

  it('sanitizes refreshed token metadata before storing connection metadata', async () => {
    await upsertConnection(
      db,
      connection({
        id: 'conn_1',
        platform: 'tiktok',
        encryptedAccessToken: await encryptToken('old-access-token', KEY),
        encryptedRefreshToken: await encryptToken('old-refresh-token', KEY),
        tokenExpiresAt: 1_000,
        metadataJson: '{}',
      }),
    )
    await createOrGetJob(db, job({ id: 'job_1', platform: 'tiktok' }))
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'video.publish',
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { privacy_level_options: ['SELF_ONLY'] } }))
      .mockResolvedValueOnce(Response.json({ data: { publish_id: 'publish-id' }, error: { code: 'ok' } }))

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).resolves.toMatchObject({
      status: 'processing',
    })

    const updated = await getConnection(db, 'conn_1', PUBKEY_A)
    expect(updated?.metadataJson).not.toContain('new-access-token')
    expect(updated?.metadataJson).not.toContain('new-refresh-token')
    expect(updated?.metadataJson).toContain('expires_in')
  })

  it('marks revoked tokens as needs_reauth on the job and connection', async () => {
    await seedConnectedJob(db, 'tiktok')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'access_token_invalid' } }))

    await expect(processCrosspostJob(platformEnv(db, 'tiktok'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'needs_reauth',
    })

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'needs_reauth',
      errorCode: 'needs_reauth',
    })
    await expect(getConnection(db, 'conn_1', PUBKEY_A)).resolves.toMatchObject({ status: 'needs_reauth' })
  })

  it('schedules retry for rate limited provider failures', async () => {
    await seedConnectedJob(db, 'instagram')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'try later' } }, { status: 429 }))

    await expect(processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 })).rejects.toBeInstanceOf(
      PublisherRetryError,
    )

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'rate_limited',
      retryCount: 1,
      nextRetryAt: 2_060,
    })
  })

  it('skips expired jobs before publishing', async () => {
    await seedConnectedJob(db, 'instagram', { expiresAt: 1_999 })

    await expect(processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'skipped',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({ status: 'skipped', errorCode: 'expired' })
  })

  it('marks terminal media rejection as failed without retrying', async () => {
    await seedConnectedJob(db, 'instagram')
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'media_rejected', message: 'media rejected' } }, { status: 400 }),
    )

    await expect(processCrosspostJob(platformEnv(db, 'instagram'), 'job_1', { now: 2_000 })).resolves.toEqual({
      status: 'failed',
    })

    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'media_rejected',
      retryCount: 0,
      nextRetryAt: null,
    })
  })
})
