import { env as workerEnv } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index'
import { recordAttempt } from '../db/attempts'
import { upsertConnection } from '../db/connections'
import { createOrGetJob } from '../db/jobs'
import { applyMigrations, connection, job, PUBKEY_A, VIDEO_EVENT_ID } from '../db/test-helpers'
import type { Env } from '../types'

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_EVENT_ID,
    pubkey: PUBKEY_A,
    kind: 34236,
    created_at: 2_000,
    content: 'caption from event',
    tags: [['imeta', 'url', 'https://media.divine.video/video.mp4', 'x', 'abc123']],
    sig: 'f'.repeat(128),
    ...overrides,
  }
}

function testEnv(db: D1Database, queueSend: ReturnType<typeof vi.fn>): Env {
  return {
    ...workerEnv,
    DB: db,
    CROSSPOST_QUEUE: { send: queueSend } as unknown as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ENABLE_TIKTOK: 'true',
    TIKTOK_CLIENT_KEY: 'tiktok-client',
    TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  } as Env
}

function authenticatedInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      authorization: 'Bearer keycast-token',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  }
}

describe('crosspost routes', () => {
  let db: D1Database
  let queueSend: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    queueSend = vi.fn()
    fetchMock = vi.fn((url: string) => {
      if (url === 'https://login.divine.video/api/nostr') {
        return Promise.resolve(Response.json({ result: PUBKEY_A }))
      }
      if (url === `https://api.divine.video/api/videos/${VIDEO_EVENT_ID}`) {
        return Promise.resolve(Response.json({ event: event() }))
      }
      return Promise.resolve(Response.json({ error: 'not found' }, { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates manual crosspost jobs for the authenticated user', async () => {
    const res = await app.request(
      `/videos/${VIDEO_EVENT_ID}/crossposts`,
      authenticatedInit({
        method: 'POST',
        body: JSON.stringify({ platforms: ['tiktok'] }),
      }),
      testEnv(db, queueSend),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      jobs: [expect.objectContaining({ platform: 'tiktok', videoEventId: VIDEO_EVENT_ID, status: 'queued' })],
    })
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('lists video jobs for the authenticated user', async () => {
    await createOrGetJob(db, job({ id: 'job_existing', connectionId: 'conn_tiktok' }))

    const res = await app.request(
      `/videos/${VIDEO_EVENT_ID}/crossposts`,
      authenticatedInit(),
      testEnv(db, queueSend),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      jobs: [expect.objectContaining({ id: 'job_existing', videoEventId: VIDEO_EVENT_ID })],
    })
  })

  it('returns a job with attempts for the authenticated user', async () => {
    await createOrGetJob(db, job({ id: 'job_existing', connectionId: 'conn_tiktok' }))
    await recordAttempt(db, {
      id: 'attempt_1',
      jobId: 'job_existing',
      status: 'failed',
      errorCode: 'rate_limited',
      errorMessage: 'slow down',
      providerStatus: 429,
      providerResponseJson: '{"error":"rate_limit"}',
      createdAt: 2_000,
    })

    const res = await app.request('/jobs/job_existing', authenticatedInit(), testEnv(db, queueSend))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      job: expect.objectContaining({ id: 'job_existing' }),
      attempts: [expect.objectContaining({ id: 'attempt_1', errorCode: 'rate_limited' })],
    })
  })

  it('maps non-owner crosspost attempts to a 403 JSON error', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://login.divine.video/api/nostr') {
        return Promise.resolve(Response.json({ result: PUBKEY_A }))
      }
      return Promise.resolve(Response.json({ event: event({ pubkey: 'b'.repeat(64) }) }))
    })

    const res = await app.request(
      `/videos/${VIDEO_EVENT_ID}/crossposts`,
      authenticatedInit({
        method: 'POST',
        body: JSON.stringify({ platforms: ['tiktok'] }),
      }),
      testEnv(db, queueSend),
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      error: { code: 'not_owner', message: 'video does not belong to authenticated user' },
    })
    expect(queueSend).not.toHaveBeenCalled()
  })
})
