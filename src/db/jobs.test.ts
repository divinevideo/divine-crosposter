import { beforeEach, describe, expect, it } from 'vitest'
import { upsertConnection } from './connections'
import {
  claimJobForPublish,
  createOrGetJob,
  getJob,
  listJobsForVideo,
  listRunnableJobs,
  recoverStalePollClaims,
  recoverStaleXClaims,
  transitionClaimToDispatching,
  updateClaimedJobStatus,
  updateJobStatus,
} from './jobs'
import { applyMigrations, connection, job, PUBKEY_A, VIDEO_EVENT_ID } from './test-helpers'

describe('job repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
    await upsertConnection(db, connection({ id: 'conn_1' }))
  })

  it('returns created false for duplicate idempotency input', async () => {
    const first = await createOrGetJob(db, job({ id: 'job_original' }))
    const duplicate = await createOrGetJob(db, job({ id: 'job_duplicate', caption: 'ignored duplicate caption' }))

    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.job).toMatchObject({ id: 'job_original', caption: 'six seconds of weird human internet' })
  })

  it('returns the existing job when a concurrent duplicate insert wins the race', async () => {
    const existingRow = {
      id: 'job_existing',
      pubkey: PUBKEY_A,
      video_event_id: VIDEO_EVENT_ID,
      platform: 'tiktok',
      connection_id: 'conn_1',
      external_account_id: 'external-account-1',
      source_media_url: 'https://cdn.divine.video/video.mp4',
      source_media_hash: 'sha256:example',
      caption: 'already inserted by another callback',
      status: 'queued',
      error_code: null,
      error_message: null,
      external_post_id: null,
      external_post_url: null,
      retry_count: 0,
      next_retry_at: null,
      expires_at: 174_000,
      created_at: 1_000,
      updated_at: 1_000,
    }
    let selectCount = 0
    const racingDb = {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first() {
                if (query.includes('SELECT * FROM jobs')) {
                  selectCount += 1
                  return selectCount === 1 ? null : existingRow
                }
                return null
              },
              async run() {
                if (query.includes('INSERT OR IGNORE INTO jobs')) {
                  return { meta: { changes: 0 }, success: true }
                }
                if (query.includes('INSERT INTO jobs')) {
                  throw new Error('UNIQUE constraint failed: jobs.pubkey, jobs.video_event_id, jobs.platform, jobs.external_account_id')
                }
                return { meta: { changes: 0 }, success: true }
              },
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(createOrGetJob(racingDb, job({ id: 'job_loser' }))).resolves.toEqual({
      created: false,
      job: expect.objectContaining({
        id: 'job_existing',
        caption: 'already inserted by another callback',
      }),
    })
  })

  it('lists jobs for a video and runnable queued jobs', async () => {
    const { job: created } = await createOrGetJob(db, job({ id: 'job_runnable', nextRetryAt: null }))

    await expect(listJobsForVideo(db, PUBKEY_A, VIDEO_EVENT_ID)).resolves.toEqual([created])
    await expect(getJob(db, 'job_runnable', PUBKEY_A)).resolves.toEqual(created)
    await expect(listRunnableJobs(db, 1_500, 10)).resolves.toEqual([created])
  })

  it('lists due queued, failed, and processing jobs but excludes claims, future retries, expired and terminal jobs', async () => {
    const now = 3_000
    const candidates = [
      ['queued_due', 'queued', null, now + 1_000, null],
      ['failed_due', 'failed', now, now + 1_000, 'media_rejected'],
      ['processing_due', 'processing', now - 1, now + 1_000, null],
      ['queued_future', 'queued', now + 1, now + 1_000, null],
      ['failed_future', 'failed', now + 1, now + 1_000, 'unknown_platform_error'],
      ['failed_terminal', 'failed', null, now + 1_000, 'media_rejected'],
      ['uploading', 'uploading', null, now + 1_000, null],
      ['dispatching', 'dispatching', null, now + 1_000, null],
      ['posted', 'posted', null, now + 1_000, null],
      ['needs_reauth', 'needs_reauth', null, now + 1_000, null],
      ['expired', 'queued', null, now, null],
    ] as const
    for (const [id, status, nextRetryAt, expiresAt, errorCode] of candidates) {
      await createOrGetJob(
        db,
        job({
          id,
          videoEventId: id.padEnd(64, '0'),
          externalAccountId: id,
          status,
          nextRetryAt,
          expiresAt,
          errorCode,
        }),
      )
    }

    await expect(listRunnableJobs(db, now, 20)).resolves.toEqual([
      expect.objectContaining({ id: 'queued_due' }),
      expect.objectContaining({ id: 'processing_due' }),
      expect.objectContaining({ id: 'failed_due' }),
    ])
  })

  it('recovers stale poll-platform claims to processing with a container id, retryable failed without', async () => {
    const now = 20_000
    const leaseSeconds = 300
    const stale = now - leaseSeconds
    const make = async (id: string, platform: 'instagram' | 'tiktok' | 'x', externalPostId: string | null, updatedAt: number, expiresAt = now + 10_000) => {
      await createOrGetJob(db, job({ id, videoEventId: id.padEnd(64, '0'), externalAccountId: id, platform, expiresAt }))
      await updateJobStatus(db, { id, status: 'uploading', updatedAt, externalPostId })
    }
    await make('ig_poll_stale', 'instagram', 'container-1', stale)
    await make('ig_upload_stale', 'instagram', null, stale)
    await make('ig_fresh', 'instagram', 'container-2', stale + 1)
    await make('ig_expired', 'instagram', 'container-3', stale, now)
    await make('x_stale', 'x', null, stale)

    await expect(recoverStalePollClaims(db, now, leaseSeconds)).resolves.toEqual({
      pollRecovered: 2,
      uploadRecovered: 1,
    })
    await expect(getJob(db, 'ig_poll_stale')).resolves.toMatchObject({
      status: 'processing',
      errorCode: null,
      nextRetryAt: now,
      updatedAt: now,
    })
    await expect(getJob(db, 'ig_upload_stale')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'unknown_platform_error',
      retryCount: 1,
      nextRetryAt: now,
    })
    await expect(getJob(db, 'ig_fresh')).resolves.toMatchObject({ status: 'uploading' })
    await expect(getJob(db, 'ig_expired')).resolves.toMatchObject({ status: 'skipped', errorCode: 'expired' })
    await expect(getJob(db, 'x_stale')).resolves.toMatchObject({ status: 'uploading' })
  })

  it('recovers only stale X upload and dispatch claims with terminal-safe outcomes', async () => {
    const now = 10_000
    const leaseSeconds = 300
    const candidates = [
      ['stale_upload', 'x', 'uploading', now - leaseSeconds, 2],
      ['stale_dispatch', 'x', 'dispatching', now - leaseSeconds - 1, 3],
      ['fresh_upload', 'x', 'uploading', now - leaseSeconds + 1, 4],
      ['fresh_dispatch', 'x', 'dispatching', now - leaseSeconds + 1, 4],
      ['other_upload', 'tiktok', 'uploading', now - 9_000, 5],
      ['other_dispatch', 'tiktok', 'dispatching', now - 9_000, 5],
      ['other_status', 'x', 'processing', now - 9_000, 6],
    ] as const
    for (const [id, platform, status, updatedAt, retryCount] of candidates) {
      await createOrGetJob(
        db,
        job({
          id,
          videoEventId: id.padEnd(64, '0'),
          externalAccountId: id,
          platform,
          status,
          updatedAt,
          retryCount,
        }),
      )
    }
    for (const [id, retryCount, expiresAt] of [
      ['retry_boundary', 4, now + 10_000],
      ['retry_exhausted', 5, now + 10_000],
      ['expired_upload', 1, now],
    ] as const) {
      await createOrGetJob(
        db,
        job({
          id,
          videoEventId: id.padEnd(64, '0'),
          externalAccountId: id,
          platform: 'x',
          status: 'uploading',
          updatedAt: now - leaseSeconds,
          retryCount,
          expiresAt,
        }),
      )
    }

    await expect(recoverStaleXClaims(db, now, leaseSeconds)).resolves.toEqual({
      uploadingRecovered: 4,
      dispatchingFailed: 1,
    })
    await expect(getJob(db, 'stale_upload')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'unknown_platform_error',
      errorMessage: 'stale X upload claim recovered before dispatch',
      retryCount: 3,
      nextRetryAt: now,
      updatedAt: now,
    })
    await expect(getJob(db, 'stale_dispatch')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'ambiguous_post_result',
      errorMessage: 'stale X dispatch requires manual reconciliation',
      retryCount: 3,
      nextRetryAt: null,
      updatedAt: now,
    })
    await expect(getJob(db, 'retry_boundary')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'unknown_platform_error',
      retryCount: 5,
      nextRetryAt: now,
    })
    await expect(getJob(db, 'retry_exhausted')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'unknown_platform_error',
      retryCount: 6,
      nextRetryAt: null,
    })
    await expect(getJob(db, 'expired_upload')).resolves.toMatchObject({
      status: 'skipped',
      errorCode: 'expired',
      retryCount: 1,
      nextRetryAt: null,
    })
    const runnableIds = (await listRunnableJobs(db, now, 20)).map((candidate) => candidate.id)
    expect(runnableIds).toEqual(expect.arrayContaining(['other_status', 'stale_upload', 'retry_boundary']))
    expect(runnableIds).not.toEqual(expect.arrayContaining(['retry_exhausted', 'expired_upload', 'stale_dispatch']))
    await expect(recoverStaleXClaims(db, now, leaseSeconds)).resolves.toEqual({
      uploadingRecovered: 0,
      dispatchingFailed: 0,
    })
    await expect(getJob(db, 'fresh_upload')).resolves.toMatchObject({ status: 'uploading', retryCount: 4 })
    await expect(getJob(db, 'fresh_dispatch')).resolves.toMatchObject({ status: 'dispatching', retryCount: 4 })
    await expect(getJob(db, 'other_upload')).resolves.toMatchObject({ status: 'uploading', retryCount: 5 })
    await expect(getJob(db, 'other_dispatch')).resolves.toMatchObject({ status: 'dispatching', retryCount: 5 })
  })

  it('prevents a recovered stale worker claim token from mutating a reclaimed job', async () => {
    await createOrGetJob(db, job({ id: 'recovered_claim', platform: 'x' }))
    const stale = await claimJobForPublish(db, 'recovered_claim', 1_000)
    expect(stale).toMatchObject({ status: 'uploading', updatedAt: 1_000 })
    await recoverStaleXClaims(db, 2_000, 300)
    const current = await claimJobForPublish(db, 'recovered_claim', 2_001)
    expect(current).toMatchObject({ status: 'uploading', updatedAt: 2_001 })

    await expect(
      updateClaimedJobStatus(
        db,
        { id: 'recovered_claim', status: 'posted', updatedAt: 2_100 },
        { status: 'uploading', updatedAt: 1_000 },
      ),
    ).resolves.toBeNull()
    await expect(getJob(db, 'recovered_claim')).resolves.toMatchObject({ status: 'uploading', updatedAt: 2_001 })
  })

  it('updates job status fields without replacing source snapshot fields', async () => {
    await createOrGetJob(db, job({ id: 'job_update' }))

    await updateJobStatus(db, {
      id: 'job_update',
      status: 'posted',
      updatedAt: 2_000,
      externalPostId: 'post_1',
      externalPostUrl: 'https://platform.example/post_1',
      errorCode: null,
      errorMessage: null,
    })

    await expect(getJob(db, 'job_update', PUBKEY_A)).resolves.toMatchObject({
      id: 'job_update',
      caption: 'six seconds of weird human internet',
      status: 'posted',
      externalPostId: 'post_1',
      externalPostUrl: 'https://platform.example/post_1',
      updatedAt: 2_000,
    })
  })

  it('clears stale nullable status fields when callers pass null explicitly', async () => {
    await createOrGetJob(
      db,
      job({
        id: 'job_clear_fields',
        status: 'failed',
        errorCode: 'rate_limited',
        errorMessage: 'try later',
        externalPostId: 'stale_post',
        externalPostUrl: 'https://platform.example/stale_post',
      }),
    )

    await updateJobStatus(db, {
      id: 'job_clear_fields',
      status: 'queued',
      updatedAt: 2_000,
      errorCode: null,
      errorMessage: null,
      externalPostId: null,
      externalPostUrl: null,
      nextRetryAt: null,
    })

    await expect(getJob(db, 'job_clear_fields', PUBKEY_A)).resolves.toMatchObject({
      status: 'queued',
      errorCode: null,
      errorMessage: null,
      externalPostId: null,
      externalPostUrl: null,
      nextRetryAt: null,
      updatedAt: 2_000,
    })
  })

  it('transitions only the current uploading claim token to dispatching', async () => {
    await createOrGetJob(db, job({ id: 'job_dispatch' }))
    const claimed = await claimJobForPublish(db, 'job_dispatch', 2_000)
    expect(claimed).toMatchObject({ status: 'uploading', updatedAt: 2_000 })

    await expect(transitionClaimToDispatching(db, 'job_dispatch', 1_999, 2_001)).resolves.toBe(false)
    await expect(getJob(db, 'job_dispatch', PUBKEY_A)).resolves.toMatchObject({
      status: 'uploading',
      updatedAt: 2_000,
    })

    await expect(transitionClaimToDispatching(db, 'job_dispatch', 2_000, 2_001)).resolves.toBe(true)
    await expect(getJob(db, 'job_dispatch', PUBKEY_A)).resolves.toMatchObject({
      status: 'dispatching',
      updatedAt: 2_001,
    })
    await expect(transitionClaimToDispatching(db, 'job_dispatch', 2_000, 2_002)).resolves.toBe(false)
  })

  it('conditionally updates a claimed job only for the expected status and ownership token', async () => {
    await createOrGetJob(db, job({ id: 'job_owned_update' }))
    await claimJobForPublish(db, 'job_owned_update', 2_000)

    await expect(
      updateClaimedJobStatus(
        db,
        { id: 'job_owned_update', status: 'processing', updatedAt: 2_100, nextRetryAt: 2_160 },
        { status: 'processing', updatedAt: 2_000 },
      ),
    ).resolves.toBeNull()
    await expect(
      updateClaimedJobStatus(
        db,
        { id: 'job_owned_update', status: 'processing', updatedAt: 2_100, nextRetryAt: 2_160 },
        { status: 'uploading', updatedAt: 1_999 },
      ),
    ).resolves.toBeNull()

    await expect(
      updateClaimedJobStatus(
        db,
        { id: 'job_owned_update', status: 'processing', updatedAt: 2_100, nextRetryAt: 2_160 },
        { status: 'uploading', updatedAt: 2_000 },
      ),
    ).resolves.toMatchObject({ status: 'processing', updatedAt: 2_100, nextRetryAt: 2_160 })
  })
})
