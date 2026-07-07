import { beforeEach, describe, expect, it } from 'vitest'
import { upsertConnection } from './connections'
import { createOrGetJob, getJob, listJobsForVideo, listRunnableJobs, updateJobStatus } from './jobs'
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
})
