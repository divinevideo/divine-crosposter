import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutomaticCrossposts, createManualCrossposts } from './crossposts'
import { upsertConnection } from '../db/connections'
import { setPreference } from '../db/preferences'
import { applyMigrations, connection, PUBKEY_A, PUBKEY_B, VIDEO_EVENT_ID } from '../db/test-helpers'
import type { Env, Platform } from '../types'

const YOUTUBE_EVENT_ID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_EVENT_ID,
    pubkey: PUBKEY_A,
    kind: 34236,
    created_at: 2_000,
    content: 'six seconds of weird human internet',
    tags: [['imeta', 'url', 'https://media.divine.video/video.mp4', 'x', 'abc123']],
    sig: 'f'.repeat(128),
    ...overrides,
  }
}

function nip71Event(overrides: Record<string, unknown> = {}) {
  return event({
    tags: [['imeta', 'url https://media.divine.video/video.mp4', 'm video/mp4', 'x abc123']],
    ...overrides,
  })
}

function testEnv(db: D1Database, queueSend: ReturnType<typeof vi.fn>): Env {
  return {
    DB: db,
    CROSSPOST_QUEUE: { send: queueSend } as unknown as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ENABLE_TIKTOK: 'true',
    ENABLE_YOUTUBE: 'true',
    TIKTOK_CLIENT_KEY: 'tiktok-client',
    TIKTOK_CLIENT_SECRET: 'tiktok-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
  }
}

async function addConnectedPlatform(db: D1Database, platform: Platform, id: string) {
  await upsertConnection(
    db,
    connection({
      id,
      platform,
      externalAccountId: `${platform}-external-account`,
      externalAccountName: `${platform} account`,
    }),
  )
}

describe('crosspost service', () => {
  let db: D1Database
  let queueSend: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    queueSend = vi.fn()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manual crosspost creates one job per selected connected platform', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    await addConnectedPlatform(db, 'youtube', 'conn_youtube')
    fetchMock.mockResolvedValueOnce(Response.json({ event: event() }))

    const result = await createManualCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
      platforms: ['tiktok', 'youtube'],
    })

    expect(result.jobs).toHaveLength(2)
    expect(result.jobs.map((job) => job.platform)).toEqual(['tiktok', 'youtube'])
    expect(result.jobs[0]).toMatchObject({
      pubkey: PUBKEY_A,
      videoEventId: VIDEO_EVENT_ID,
      sourceMediaUrl: 'https://media.divine.video/video.mp4',
      sourceMediaHash: 'abc123',
      caption: 'six seconds of weird human internet',
      status: 'queued',
    })
    expect(result.jobs[0].expiresAt - result.jobs[0].createdAt).toBe(48 * 60 * 60)
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenNthCalledWith(1, { jobId: result.jobs[0].id })
    expect(queueSend).toHaveBeenNthCalledWith(2, { jobId: result.jobs[1].id })
  })

  it('accepts real NIP-71 imeta entries for Divine media URLs and hashes', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockResolvedValueOnce(Response.json({ event: nip71Event() }))

    const result = await createManualCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
      platforms: ['tiktok'],
    })

    expect(result.jobs[0]).toMatchObject({
      sourceMediaUrl: 'https://media.divine.video/video.mp4',
      sourceMediaHash: 'abc123',
    })
  })

  it('rejects non-Divine media URLs', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockResolvedValueOnce(
      Response.json({ event: nip71Event({ tags: [['imeta', 'url https://example.com/video.mp4', 'x abc123']] }) }),
    )

    await expect(
      createManualCrossposts(testEnv(db, queueSend), {
        pubkey: PUBKEY_A,
        eventId: VIDEO_EVENT_ID,
        platforms: ['tiktok'],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'not_eligible' })
  })

  it('duplicate manual request returns the same jobs and does not enqueue duplicates', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ event: event() })))

    const first = await createManualCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
      platforms: ['tiktok'],
    })
    const duplicate = await createManualCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
      platforms: ['tiktok'],
    })

    expect(duplicate.jobs).toEqual(first.jobs)
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('auto endpoint uses only automatic preferences', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    await addConnectedPlatform(db, 'youtube', 'conn_youtube')
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'automatic',
      automaticEnabledAt: 1_500,
      createdAt: 1_000,
      updatedAt: 1_500,
    })
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'youtube',
      connectionId: 'conn_youtube',
      mode: 'manual',
      automaticEnabledAt: null,
      createdAt: 1_000,
      updatedAt: 1_500,
    })
    fetchMock.mockResolvedValueOnce(Response.json({ event: event() }))

    const result = await createAutomaticCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
    })

    expect(result.jobs.map((job) => job.platform)).toEqual(['tiktok'])
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('auto endpoint ignores events older than automatic_enabled_at', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'automatic',
      automaticEnabledAt: 3_000,
      createdAt: 1_000,
      updatedAt: 3_000,
    })
    fetchMock.mockResolvedValueOnce(Response.json({ event: event({ created_at: 2_000 }) }))

    const result = await createAutomaticCrossposts(testEnv(db, queueSend), {
      pubkey: PUBKEY_A,
      eventId: VIDEO_EVENT_ID,
    })

    expect(result.jobs).toEqual([])
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects non-owner events with 403', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockResolvedValueOnce(Response.json({ event: event({ pubkey: PUBKEY_B }) }))

    await expect(
      createManualCrossposts(testEnv(db, queueSend), {
        pubkey: PUBKEY_A,
        eventId: VIDEO_EVENT_ID,
        platforms: ['tiktok'],
      }),
    ).rejects.toMatchObject({ status: 403, code: 'not_owner' })
  })

  it('rejects unsupported event kinds with not_eligible', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockResolvedValueOnce(Response.json({ event: event({ kind: 1 }) }))

    await expect(
      createManualCrossposts(testEnv(db, queueSend), {
        pubkey: PUBKEY_A,
        eventId: VIDEO_EVENT_ID,
        platforms: ['tiktok'],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'not_eligible' })
  })

  it('rejects missing media URL or hash with not_eligible', async () => {
    await addConnectedPlatform(db, 'tiktok', 'conn_tiktok')
    fetchMock.mockResolvedValueOnce(Response.json({ event: event({ tags: [['imeta', 'url', 'https://media.divine.video/video.mp4']] }) }))

    await expect(
      createManualCrossposts(testEnv(db, queueSend), {
        pubkey: PUBKEY_A,
        eventId: VIDEO_EVENT_ID,
        platforms: ['tiktok'],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'not_eligible' })
  })

  it('rejects when the fetched event id does not match the request', async () => {
    await addConnectedPlatform(db, 'youtube', 'conn_youtube')
    fetchMock.mockResolvedValueOnce(Response.json({ event: event({ id: YOUTUBE_EVENT_ID }) }))

    await expect(
      createManualCrossposts(testEnv(db, queueSend), {
        pubkey: PUBKEY_A,
        eventId: VIDEO_EVENT_ID,
        platforms: ['youtube'],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'not_eligible' })
  })
})
