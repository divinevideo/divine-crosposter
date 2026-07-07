import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVideoEvent, listRecentUserVideos } from './client'
import type { Env } from '../types'
import { PUBKEY_A, VIDEO_EVENT_ID } from '../db/test-helpers'

function env(): Env {
  return {
    DB: {} as D1Database,
    CROSSPOST_QUEUE: {} as Queue<{ jobId: string }>,
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video/',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_EVENT_ID,
    pubkey: PUBKEY_A,
    kind: 34236,
    created_at: 2_000,
    content: 'caption',
    tags: [['imeta', 'url', 'https://media.divine.video/video.mp4', 'x', 'abc123']],
    sig: 'f'.repeat(128),
    ...overrides,
  }
}

describe('Funnelcake client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a single video event and accepts the event envelope response', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ event: event() }))

    const result = await fetchVideoEvent(env(), VIDEO_EVENT_ID)

    expect(result).toMatchObject({ id: VIDEO_EVENT_ID, pubkey: PUBKEY_A, kind: 34236 })
    expect(fetchMock).toHaveBeenCalledWith(`https://api.divine.video/api/videos/${VIDEO_EVENT_ID}`, {
      headers: { accept: 'application/json' },
    })
  })

  it('returns null for missing single video events', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'not found' }, { status: 404 }))

    await expect(fetchVideoEvent(env(), VIDEO_EVENT_ID)).resolves.toBeNull()
  })

  it('lists recent user videos and hydrates non-event candidates through the single-video endpoint', async () => {
    const hydratedEventId = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          videos: [event(), { event_id: hydratedEventId }],
          next_cursor: 'cursor-2',
        }),
      )
      .mockResolvedValueOnce(Response.json(event({ id: hydratedEventId })))

    const result = await listRecentUserVideos(env(), { pubkey: PUBKEY_A, cursor: 'cursor-1', limit: 2 })

    expect(result).toEqual({
      events: [expect.objectContaining({ id: VIDEO_EVENT_ID }), expect.objectContaining({ id: hydratedEventId })],
      nextCursor: 'cursor-2',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.divine.video/api/v2/users/${PUBKEY_A}/videos?cursor=cursor-1&limit=2`,
      { headers: { accept: 'application/json' } },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.divine.video/api/videos/${hydratedEventId}`,
      { headers: { accept: 'application/json' } },
    )
  })
})
