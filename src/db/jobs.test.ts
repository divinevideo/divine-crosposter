import { beforeEach, describe, expect, it } from 'vitest'
import { upsertConnection } from './connections'
import {
  claimJobForPublish,
  createOrGetJob,
  getJob,
  listJobsForVideo,
  listRunnableJobs,
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
