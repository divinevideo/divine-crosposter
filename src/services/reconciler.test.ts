import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCursor, upsertCursor } from '../db/cursors'
import { upsertConnection } from '../db/connections'
import { listJobsForVideo } from '../db/jobs'
import { setPreference } from '../db/preferences'
import { applyMigrations, connection, PUBKEY_A, VIDEO_EVENT_ID } from '../db/test-helpers'
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

function mockRecentAndHydrate(fetchMock: ReturnType<typeof vi.fn>, events: ReturnType<typeof event>[], nextCursor = 'cursor-2') {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith(`https://api.divine.video/api/v2/users/${PUBKEY_A}/videos`)) {
      return Promise.resolve(
        Response.json({
          videos: events.map((candidate) => ({ event_id: candidate.id })),
          next_cursor: nextCursor,
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

    expect(result).toMatchObject({ usersChecked: 1, eventsChecked: 1, jobsCreatedOrFound: 1 })
    expect(queueSend).toHaveBeenCalledTimes(1)
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toHaveLength(1)
  })

  it('does not duplicate jobs on repeated reconciler runs', async () => {
    await seedPreference(db, { mode: 'automatic' })
    mockRecentAndHydrate(fetchMock, [event()])

    await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })
    await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_300 })

    expect(queueSend).toHaveBeenCalledTimes(1)
    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toHaveLength(1)
  })

  it('ignores manual-only preferences', async () => {
    await seedPreference(db, { mode: 'manual' })

    const result = await runAutoCrosspostReconciliation(env(db, queueSend), { now: 3_000 })

    expect(result).toEqual({ usersChecked: 0, eventsChecked: 0, jobsCreatedOrFound: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
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
})
