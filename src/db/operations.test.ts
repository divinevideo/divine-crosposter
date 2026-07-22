import { beforeEach, describe, expect, it } from 'vitest'
import { createOrGetJob, recoverStaleXClaims } from './jobs'
import {
  countOverdueRunnableJobs,
  getOldestUnconsumedAlertTest,
  markAlertTestConsumed,
  requestOperationsAlertTest,
} from './operations'
import { upsertConnection } from './connections'
import { applyMigrations, connection, job } from './test-helpers'

describe('operations repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
    await upsertConnection(db, connection())
  })

  it('counts only overdue queue-runnable statuses at the grace boundary', async () => {
    const now = 10_000
    const grace = 900
    const candidates = [
      ['queued_boundary', 'queued', null, now - grace],
      ['failed_overdue', 'failed', now - grace - 1, now - 100],
      ['processing_overdue', 'processing', now - grace, now - 100],
      ['future_30m', 'processing', now + 1_800, 1],
      ['future_60m', 'failed', now + 3_600, 1],
      ['uploading_old', 'uploading', null, 1],
      ['dispatching_old', 'dispatching', null, 1],
      ['posted_old', 'posted', null, 1],
      ['skipped_old', 'skipped', null, 1],
      ['expired_queued', 'queued', null, 1],
    ] as const

    for (const [id, status, nextRetryAt, createdAt] of candidates) {
      await createOrGetJob(
        db,
        job({
          id,
          videoEventId: id.padEnd(64, '0'),
          externalAccountId: id,
          status,
          nextRetryAt,
          createdAt,
          updatedAt: createdAt,
          expiresAt: id === 'expired_queued' ? now : now + 10_000,
        }),
      )
    }
    for (const [id, errorCode, retryCount] of [
      ['terminal_media', 'media_rejected', 0],
      ['terminal_exhausted', 'unknown_platform_error', 6],
      ['terminal_ambiguous', 'ambiguous_post_result', 0],
    ] as const) {
      await createOrGetJob(
        db,
        job({
          id,
          videoEventId: id.padEnd(64, '0'),
          externalAccountId: id,
          status: 'failed',
          errorCode,
          retryCount,
          nextRetryAt: null,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: now + 10_000,
        }),
      )
    }

    await expect(countOverdueRunnableJobs(db, now, grace)).resolves.toBe(3)
  })

  it('does not count a stale dispatch recovered for manual reconciliation as overdue', async () => {
    const now = 10_000
    await upsertConnection(db, connection({ id: 'conn_x', platform: 'x' }))
    await createOrGetJob(
      db,
      job({
        id: 'stale_dispatch',
        platform: 'x',
        connectionId: 'conn_x',
        status: 'dispatching',
        createdAt: 1,
        updatedAt: 1,
        expiresAt: now + 10_000,
      }),
    )

    await recoverStaleXClaims(db, now, 300)

    await expect(countOverdueRunnableJobs(db, now, 900)).resolves.toBe(0)
  })

  it('requests, reads oldest-first, and conditionally consumes a one-shot test', async () => {
    await requestOperationsAlertTest(db, 'request_newer', 2_000)
    await requestOperationsAlertTest(db, 'request_older', 1_000)

    await expect(getOldestUnconsumedAlertTest(db)).resolves.toEqual({ id: 'request_older', requestedAt: 1_000 })
    await expect(markAlertTestConsumed(db, 'request_older', 3_000)).resolves.toBe(true)
    await expect(markAlertTestConsumed(db, 'request_older', 3_001)).resolves.toBe(false)
    await expect(getOldestUnconsumedAlertTest(db)).resolves.toEqual({ id: 'request_newer', requestedAt: 2_000 })
  })
})
