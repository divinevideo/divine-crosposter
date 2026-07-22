import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { upsertConnection } from './db/connections'
import { createOrGetJob, getJob } from './db/jobs'
import { applyMigrations, connection, job } from './db/test-helpers'
import { runAutoCrosspostReconciliation } from './services/reconciler'
import type { Env, Platform } from './types'
import { encryptToken } from './utils/crypto'

const KEY = '0123456789abcdef0123456789abcdef'

function message(jobId: string) {
  const ack = vi.fn()
  const retry = vi.fn()
  return {
    value: {
      id: `message-${jobId}`,
      timestamp: new Date(),
      body: { jobId },
      attempts: 1,
      ack,
      retry,
    } as Message<{ jobId: string }>,
    ack,
    retry,
  }
}

function batch(...messages: Message<{ jobId: string }>[]): MessageBatch<{ jobId: string }> {
  return {
    queue: 'divine-crossposter-jobs',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<{ jobId: string }>
}

function queue(send: ReturnType<typeof vi.fn>): Queue<{ jobId: string }> {
  return { send, metrics: vi.fn().mockResolvedValue({ backlogCount: 0, backlogBytes: 0 }) } as unknown as Queue<{
    jobId: string
  }>
}

function platformEnv(db: D1Database, platform: Platform, send: ReturnType<typeof vi.fn>): Env {
  const base: Env = {
    DB: db,
    CROSSPOST_QUEUE: queue(send),
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: KEY,
  }
  if (platform === 'x') {
    return { ...base, ENABLE_X: 'true', TWITTER_CLIENT_ID: 'x-client', TWITTER_CLIENT_SECRET: 'x-secret' }
  }
  if (platform === 'instagram') {
    return {
      ...base,
      ENABLE_INSTAGRAM: 'true',
      INSTAGRAM_CLIENT_ID: 'instagram-client',
      INSTAGRAM_CLIENT_SECRET: 'instagram-secret',
    }
  }
  return {
    ...base,
    ENABLE_TIKTOK: 'true',
    TIKTOK_CLIENT_KEY: 'tiktok-client',
    TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  }
}

async function seedConnectedJob(db: D1Database, platform: Platform, overrides: Parameters<typeof job>[0] = {}) {
  await upsertConnection(
    db,
    connection({
      id: 'conn_1',
      platform,
      encryptedAccessToken: await encryptToken('access-token', KEY),
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
    }),
  )
  await createOrGetJob(db, job({ id: 'job_1', platform, expiresAt: 100_000, ...overrides }))
}

describe('queue delivery lifecycle', () => {
  let db: D1Database
  let send: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = await applyMigrations()
    send = vi.fn().mockResolvedValue(undefined)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2_000_000))
  })

  it('fresh-sends a controlled result retry before acknowledging and never uses native retry', async () => {
    await seedConnectedJob(db, 'tiktok')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: { privacy_level_options: ['SELF_ONLY'] } }))
        .mockResolvedValueOnce(Response.json({ data: { publish_id: 'publish-id' }, error: { code: 'ok' } })),
    )
    const current = message('job_1')
    const order: string[] = []
    send.mockImplementation(async () => {
      order.push('send')
    })
    current.ack.mockImplementation(() => order.push('ack'))

    await worker.queue(batch(current.value), platformEnv(db, 'tiktok', send), {} as ExecutionContext)

    expect(send).toHaveBeenCalledWith({ jobId: 'job_1' }, { delaySeconds: 60 })
    expect(order).toEqual(['send', 'ack'])
    expect(current.retry).not.toHaveBeenCalled()
  })

  it('fresh-sends PublisherRetryError before acking and never calls message.retry', async () => {
    await seedConnectedJob(db, 'instagram')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'slow down' } }, { status: 429 })))
    const current = message('job_1')

    await worker.queue(batch(current.value), platformEnv(db, 'instagram', send), {} as ExecutionContext)

    expect(send).toHaveBeenCalledWith({ jobId: 'job_1' }, { delaySeconds: 60 })
    expect(current.ack).toHaveBeenCalledOnce()
    expect(current.retry).not.toHaveBeenCalled()
  })

  it('lets a failed fresh send escape unacked for native retry and scheduled recovery', async () => {
    await seedConnectedJob(db, 'tiktok')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: { privacy_level_options: ['SELF_ONLY'] } }))
        .mockResolvedValueOnce(Response.json({ data: { publish_id: 'publish-id' }, error: { code: 'ok' } })),
    )
    send.mockRejectedValueOnce(new Error('queue unavailable'))
    const current = message('job_1')
    const configured = platformEnv(db, 'tiktok', send)

    await expect(worker.queue(batch(current.value), configured, {} as ExecutionContext)).rejects.toThrow('queue unavailable')
    expect(current.ack).not.toHaveBeenCalled()
    expect(current.retry).not.toHaveBeenCalled()

    vi.setSystemTime(new Date(2_060_000))
    await runAutoCrosspostReconciliation(configured, { now: 2_060 })
    expect(send).toHaveBeenLastCalledWith({ jobId: 'job_1' })
  })

  it('acks successful terminal and not-found results', async () => {
    await seedConnectedJob(db, 'tiktok', { status: 'posted' })
    const terminal = message('job_1')
    const missing = message('missing_job')

    await worker.queue(batch(terminal.value, missing.value), platformEnv(db, 'tiktok', send), {} as ExecutionContext)

    expect(terminal.ack).toHaveBeenCalledOnce()
    expect(missing.ack).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(terminal.retry).not.toHaveBeenCalled()
    expect(missing.retry).not.toHaveBeenCalled()
  })

  it('acks a successful publish without scheduling another delivery', async () => {
    await seedConnectedJob(db, 'instagram')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
        .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
        .mockResolvedValueOnce(Response.json({ id: 'post-id', permalink: 'https://instagram.example/post-id' })),
    )
    const current = message('job_1')

    await worker.queue(batch(current.value), platformEnv(db, 'instagram', send), {} as ExecutionContext)

    expect(current.ack).toHaveBeenCalledOnce()
    expect(current.retry).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    await expect(getJob(db, 'job_1')).resolves.toMatchObject({ status: 'posted', externalPostId: 'post-id' })
  })

  it('lets unexpected infrastructure exceptions escape without ack or retry', async () => {
    const current = message('job_1')
    const brokenDb = {
      prepare() {
        throw new Error('D1 unavailable')
      },
    } as unknown as D1Database

    await expect(
      worker.queue(batch(current.value), platformEnv(brokenDb, 'tiktok', send), {} as ExecutionContext),
    ).rejects.toThrow('D1 unavailable')
    expect(current.ack).not.toHaveBeenCalled()
    expect(current.retry).not.toHaveBeenCalled()
  })

  it('bounds X processing polls with fresh delayed messages and a terminal sixth poll', async () => {
    await seedConnectedJob(db, 'x')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', processing_info: { state: 'pending' } } }))
    for (let index = 0; index < 6; index += 1) {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          data: { id: 'media-id', processing_info: { state: index % 2 === 0 ? 'in_progress' : 'pending' } },
        }),
      )
    }
    vi.stubGlobal('fetch', fetchMock)
    const configured = platformEnv(db, 'x', send)
    const deliveries: ReturnType<typeof message>[] = []

    for (let delivery = 0; delivery < 7; delivery += 1) {
      const current = message('job_1')
      deliveries.push(current)
      await worker.queue(batch(current.value), configured, {} as ExecutionContext)
      const currentJob = await getJob(db, 'job_1')
      if (currentJob?.nextRetryAt != null) vi.setSystemTime(new Date(currentJob.nextRetryAt * 1_000))
    }

    expect(send).toHaveBeenCalledTimes(6)
    expect(send.mock.calls.map((call) => call[1])).toEqual([
      { delaySeconds: 60 },
      { delaySeconds: 60 },
      { delaySeconds: 300 },
      { delaySeconds: 900 },
      { delaySeconds: 1_800 },
      { delaySeconds: 3_600 },
    ])
    expect(deliveries.every((delivery) => delivery.ack.mock.calls.length === 1)).toBe(true)
    expect(deliveries.every((delivery) => delivery.retry.mock.calls.length === 0)).toBe(true)
    await expect(getJob(db, 'job_1')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'processing_timeout',
      retryCount: 6,
      nextRetryAt: null,
    })
  })
})
