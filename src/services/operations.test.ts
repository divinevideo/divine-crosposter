import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestOperationsAlertTest } from '../db/operations'
import { createOrGetJob } from '../db/jobs'
import { upsertConnection } from '../db/connections'
import { applyMigrations, connection, job } from '../db/test-helpers'
import type { Env } from '../types'
import { runOperationalChecks } from './operations'

function queue(metrics: QueueMetrics, send = vi.fn()): Queue<{ jobId: string }> {
  return { metrics: vi.fn().mockResolvedValue(metrics), send } as unknown as Queue<{ jobId: string }>
}

function env(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CROSSPOST_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }),
    KEYCAST_URL: 'https://login.divine.video',
    FUNNELCAKE_URL: 'https://api.divine.video',
    OAUTH_REDIRECT_BASE: 'https://crossposter.divine.video',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    ...overrides,
  }
}

describe('operational checks', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
    vi.restoreAllMocks()
  })

  it('is backward compatible without a DLQ binding and performs no metrics fetch', async () => {
    const primary = queue({ backlogCount: 9, backlogBytes: 99 })

    await expect(runOperationalChecks(env(db, { CROSSPOST_QUEUE: primary }), 2_000)).resolves.toEqual([])
    expect(primary.metrics).not.toHaveBeenCalled()
  })

  it('alerts for a nonempty DLQ with aggregate, secret-safe fields only', async () => {
    const primary = queue({ backlogCount: 3, backlogBytes: 300, oldestMessageTimestamp: new Date(0) })
    const dlq = queue({ backlogCount: 2, backlogBytes: 200 }) as Queue<unknown>
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const issues = await runOperationalChecks(
      env(db, { CROSSPOST_QUEUE: primary, CROSSPOST_DLQ: dlq, OPS_ALERT_WEBHOOK_URL: 'https://alerts.example/hook-secret' }),
      10_000,
    )

    expect(primary.metrics).toHaveBeenCalledOnce()
    expect(dlq.metrics).toHaveBeenCalledOnce()
    expect(issues).toEqual([
      {
        service: 'divine-crossposter',
        observedAt: 10_000,
        issue: 'dlq_nonempty',
        backlogCount: 2,
        backlogBytes: 200,
        overdueJobCount: 0,
      },
    ])
    const body = String(fetchMock.mock.calls[0][1]?.body)
    expect(JSON.parse(body)).toEqual(issues)
    for (const forbidden of [
      'job_',
      'https://alerts',
      'token',
      'pubkey',
      'state',
      'url',
      'provider_response',
      'callback',
      'verifier',
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('uses D1 overdue state rather than queue oldest timestamp and ignores delayed future work', async () => {
    const primary = queue({ backlogCount: 1, backlogBytes: 10, oldestMessageTimestamp: new Date(0) })
    const dlq = queue({ backlogCount: 0, backlogBytes: 0 }) as Queue<unknown>
    await upsertConnection(db, connection())
    await createOrGetJob(
      db,
      job({ id: 'future_delayed', status: 'processing', createdAt: 1, nextRetryAt: 11_800, expiresAt: 20_000 }),
    )

    await expect(runOperationalChecks(env(db, { CROSSPOST_QUEUE: primary, CROSSPOST_DLQ: dlq }), 10_000)).resolves.toEqual([])
  })

  it('reports primary overdue jobs from D1 with primary aggregate metrics', async () => {
    const primary = queue({ backlogCount: 4, backlogBytes: 400, oldestMessageTimestamp: new Date() })
    const dlq = queue({ backlogCount: 0, backlogBytes: 0 }) as Queue<unknown>
    await upsertConnection(db, connection())
    await createOrGetJob(db, job({ id: 'overdue_job', createdAt: 1_000, updatedAt: 1_000, expiresAt: 20_000 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      runOperationalChecks(env(db, { CROSSPOST_QUEUE: primary, CROSSPOST_DLQ: dlq }), 10_000),
    ).resolves.toEqual([
      {
        service: 'divine-crossposter',
        observedAt: 10_000,
        issue: 'primary_jobs_overdue',
        backlogCount: 4,
        backlogBytes: 400,
        overdueJobCount: 1,
      },
    ])
    expect(String(warn.mock.calls)).not.toContain('overdue_job')
  })

  it('leaves one-shot tests pending without a webhook and logs no request id or URL', async () => {
    await requestOperationsAlertTest(db, 'private-request-id', 1_000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const configured = env(db, {
      CROSSPOST_DLQ: queue({ backlogCount: 0, backlogBytes: 0 }) as Queue<unknown>,
    })

    await expect(runOperationalChecks(configured, 2_000)).resolves.toEqual([
      expect.objectContaining({ issue: 'notification_test' }),
    ])
    expect(String(warn.mock.calls)).not.toContain('private-request-id')
    expect(String(warn.mock.calls)).not.toContain('http')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(runOperationalChecks(configured, 2_001)).resolves.toEqual([
      expect.objectContaining({ issue: 'notification_test' }),
    ])
  })

  it('consumes a one-shot test only after both metrics and a successful webhook', async () => {
    await requestOperationsAlertTest(db, 'private-request-id', 1_000)
    const primary = queue({ backlogCount: 0, backlogBytes: 0 })
    const dlq = queue({ backlogCount: 0, backlogBytes: 0 }) as Queue<unknown>
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const configured = env(db, {
      CROSSPOST_QUEUE: primary,
      CROSSPOST_DLQ: dlq,
      OPS_ALERT_WEBHOOK_URL: 'https://alerts.example/secret',
    })

    await expect(runOperationalChecks(configured, 2_000)).rejects.toThrow('operations alert webhook failed')
    await expect(runOperationalChecks(configured, 2_001)).resolves.toEqual([
      expect.objectContaining({ issue: 'notification_test' }),
    ])
    const successfulBody = String(fetchMock.mock.calls[1][1]?.body)
    expect(successfulBody).not.toContain('private-request-id')
    expect(JSON.parse(successfulBody)).toEqual([
      {
        service: 'divine-crossposter',
        observedAt: 2_001,
        issue: 'notification_test',
        backlogCount: 0,
        backlogBytes: 0,
        overdueJobCount: 0,
      },
    ])
    await expect(runOperationalChecks(configured, 2_002)).resolves.toEqual([])
  })

  it('does not read or consume a test when either metrics call fails', async () => {
    await requestOperationsAlertTest(db, 'private-request-id', 1_000)
    const failingPrimary = queue({ backlogCount: 0, backlogBytes: 0 })
    vi.mocked(failingPrimary.metrics).mockRejectedValueOnce(new Error('metrics unavailable'))
    const configured = env(db, {
      CROSSPOST_QUEUE: failingPrimary,
      CROSSPOST_DLQ: queue({ backlogCount: 0, backlogBytes: 0 }) as Queue<unknown>,
      OPS_ALERT_WEBHOOK_URL: 'https://alerts.example/secret',
    })

    await expect(runOperationalChecks(configured, 2_000)).rejects.toThrow('metrics unavailable')
    vi.mocked(failingPrimary.metrics).mockResolvedValueOnce({ backlogCount: 0, backlogBytes: 0 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()))
    await expect(runOperationalChecks(configured, 2_001)).resolves.toEqual([
      expect.objectContaining({ issue: 'notification_test' }),
    ])
  })
})
