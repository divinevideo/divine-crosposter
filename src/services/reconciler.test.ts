import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCursor, upsertCursor } from '../db/cursors'
import { upsertConnection } from '../db/connections'
import { createOrGetJob, listJobsForVideo } from '../db/jobs'
import { createOAuthAttempt, getOAuthAttempt } from '../db/oauth-attempts'
import { createOAuthState } from '../db/oauth-states'
import { setPreference } from '../db/preferences'
import { applyMigrations, connection, job, PUBKEY_A, VIDEO_EVENT_ID } from '../db/test-helpers'
import type { Env, Platform, PreferenceMode } from '../types'
import { runAutoCrosspostReconciliation } from './reconciler'

const VIDEO_EVENT_ID_2 = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

function event(id = VIDEO_EVENT_ID, createdAt = 2_000) {
  return {
    id,
    pubkey: PUBKEY_A,
    kind: 34236,
    created_at: createdAt,
    content: 'caption',
    tags: [['imeta', 'url', 'https://media.divine.video/video.mp4', 'x', 'abc123']],
    sig: 'f'.repeat(128),
  }
}

function env(db: D1Database, queueSend: ReturnType<typeof vi.fn>): Env {
  return {
    DB: db,
    CROSSPOST_QUEUE: { send: queueSend } as unknown as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ENABLE_TIKTOK: 'true',
    TIKTOK_CLIENT_KEY: 'tiktok-client',
    TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  }
}

async function seedPreference(db: D1Database, input: { mode: PreferenceMode; platform?: Platform; automaticEnabledAt?: number | null }) {
  const platform = input.platform ?? 'tiktok'
  await upsertConnection(db, connection({ id: `conn_${platform}`, platform }))
  await setPreference(db, {
    pubkey: PUBKEY_A,
    platform,
    connectionId: input.mode === 'disabled' ? null : `conn_${platform}`,
    mode: input.mode,
    automaticEnabledAt: input.automaticEnabledAt ?? (input.mode === 'automatic' ? 1_500 : null),
    createdAt: 1_000,
    updatedAt: 1_500,
  })
}

function mockRecentAndHydrate(
  fetchMock: ReturnType<typeof vi.fn>,
  events: ReturnType<typeof event>[],
  nextCursor: string | null = 'cursor-2',
) {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith(`https://api.divine.video/api/v2/users/${PUBKEY_A}/videos`)) {
      return Promise.resolve(
        Response.json({
          videos: events.map((candidate) => ({ event_id: candidate.id })),
          ...(nextCursor === null ? {} : { next_cursor: nextCursor }),
        }),
      )
    }
    const matched = events.find((candidate) => url === `https://api.divine.video/api/videos/${candidate.id}`)
    if (matched) {
      return Promise.resolve(Response.json({ event: matched }))
    }
    return Promise.resolve(Response.json({ error: 'not found' }, { status: 404 }))
  })
}

describe('automatic crosspost reconciler', () => {
  let db: D1Database
  let queueSend: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    queueSend = vi.fn()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('enqueues a missed eligible video exactly once', async () => {
    await seedPreference(db, { mode: 'automatic' })
    mockRecentAndHydrate(fetchMock, [event()])

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toMatchObject({ usersChecked: 1, eventsChecked: 1, jobsCreatedOrFound: 1, queuedJobsEnqueued: 0 })
    expect(queueSend).toHaveBeenCalledTimes(1)
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toHaveLength(1)
  })

  it('does not duplicate jobs on repeated reconciler runs', async () => {
    await seedPreference(db, { mode: 'automatic' })
    mockRecentAndHydrate(fetchMock, [event()])

    await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })
    await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_300 })

    expect(queueSend).toHaveBeenCalledTimes(2)
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toHaveLength(1)
  })

  it('ignores manual-only preferences', async () => {
    await seedPreference(db, { mode: 'manual' })

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toEqual({
      usersChecked: 0,
      eventsChecked: 0,
      jobsCreatedOrFound: 0,
      queuedJobsEnqueued: 0,
      oauthAttemptsExpired: 0,
      oauthStatesDeleted: 0,
      uploadingRecovered: 0,
      dispatchingFailed: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('expires abandoned OAuth starts and deletes their expired states', async () => {
    await createOAuthAttempt(db, {
      id: 'oauth_attempt_abandoned',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'started',
      failureCode: null,
      providerStatus: null,
      createdAt: 1_000,
      expiresAt: 2_000,
      updatedAt: 1_000,
    })
    await createOAuthState(db, {
      stateId: 'expired-private-state',
      pubkey: PUBKEY_A,
      platform: 'x',
      codeVerifier: 'expired-private-verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 2_000,
      metadataJson: JSON.stringify({ attemptId: 'oauth_attempt_abandoned' }),
    })

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result.oauthAttemptsExpired).toBe(1)
    expect(result.oauthStatesDeleted).toBe(1)
    await expect(getOAuthAttempt(db, 'oauth_attempt_abandoned')).resolves.toMatchObject({ status: 'expired' })
    await expect(
      db.prepare('SELECT state_id FROM oauth_states WHERE state_id = ?').bind('expired-private-state').first(),
    ).resolves.toBeNull()
  })

  it('advances cursor after inspected videos', async () => {
    await seedPreference(db, { mode: 'automatic' })
    mockRecentAndHydrate(fetchMock, [event(VIDEO_EVENT_ID, 2_000), event(VIDEO_EVENT_ID_2, 2_500)], 'cursor-next')

    await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    await expect(getCursor(db, PUBKEY_A)).resolves.toMatchObject({
      pubkey: PUBKEY_A,
      cursor: 'cursor-next',
      lastCheckedAt: 2_500,
      updatedAt: 3_000,
    })
  })

  it('uses last_checked_at to skip previously inspected videos when no cursor is available', async () => {
    await seedPreference(db, { mode: 'automatic' })
    await upsertCursor(db, { pubkey: PUBKEY_A, cursor: null, lastCheckedAt: 2_000, updatedAt: 2_000 })
    mockRecentAndHydrate(fetchMock, [event(VIDEO_EVENT_ID, 1_900), event(VIDEO_EVENT_ID_2, 2_500)], null)

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toMatchObject({ eventsChecked: 1, jobsCreatedOrFound: 1 })
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toHaveLength(0)
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID_2)).resolves.toHaveLength(1)
  })

  it('does not move last_checked_at backwards when no cursor is available', async () => {
    await seedPreference(db, { mode: 'automatic' })
    await upsertCursor(db, { pubkey: PUBKEY_A, cursor: null, lastCheckedAt: 3_000, updatedAt: 3_000 })
    mockRecentAndHydrate(fetchMock, [event(VIDEO_EVENT_ID, 2_500)], null)

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_300 })

    expect(result).toMatchObject({ eventsChecked: 0, jobsCreatedOrFound: 0 })
    await expect(getCursor(db, PUBKEY_A)).resolves.toMatchObject({
      cursor: null,
      lastCheckedAt: 3_000,
      updatedAt: 3_300,
    })
  })

  it('does not advance cursor when Funnelcake fails', async () => {
    await seedPreference(db, { mode: 'automatic' })
    await upsertCursor(db, { pubkey: PUBKEY_A, cursor: 'cursor-old', lastCheckedAt: 1_000, updatedAt: 1_000 })
    fetchMock.mockResolvedValue(Response.json({ error: 'down' }, { status: 500 }))

    await expect(runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })).rejects.toMatchObject({
      status: 502,
      code: 'funnelcake_unavailable',
    })

    await expect(getCursor(db, PUBKEY_A)).resolves.toMatchObject({
      cursor: 'cursor-old',
      lastCheckedAt: 1_000,
      updatedAt: 1_000,
    })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('re-enqueues runnable queued jobs as an outbox recovery path', async () => {
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
    await createOrGetJob(db, job({ id: 'job_stranded', connectionId: 'conn_tiktok', nextRetryAt: null }))

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toMatchObject({ queuedJobsEnqueued: 1 })
    expect(queueSend).toHaveBeenCalledWith({ jobId: 'job_stranded' })
  })

  it('recovers stale X claims before enqueueing and never requeues ambiguous dispatches', async () => {
    await upsertConnection(db, connection({ id: 'conn_x', platform: 'x' }))
    await createOrGetJob(
      db,
      job({ id: 'stale_upload', platform: 'x', connectionId: 'conn_x', status: 'uploading', updatedAt: 2_699 }),
    )
    await createOrGetJob(
      db,
      job({
        id: 'stale_dispatch',
        videoEventId: VIDEO_EVENT_ID_2,
        externalAccountId: 'second-account',
        platform: 'x',
        connectionId: 'conn_x',
        status: 'dispatching',
        updatedAt: 2_699,
      }),
    )

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toMatchObject({ uploadingRecovered: 1, dispatchingFailed: 1, queuedJobsEnqueued: 1 })
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend).toHaveBeenCalledWith({ jobId: 'stale_upload' })
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID_2)).resolves.toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'ambiguous_post_result', nextRetryAt: null }),
    ])
  })
})
