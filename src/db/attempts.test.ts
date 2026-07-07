import { beforeEach, describe, expect, it } from 'vitest'
import { upsertConnection } from './connections'
import { recordAttempt, listAttempts } from './attempts'
import { createOrGetJob, getJob } from './jobs'
import { applyMigrations, connection, job, PUBKEY_A } from './test-helpers'

describe('attempt repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
    await upsertConnection(db, connection({ id: 'conn_1' }))
    await createOrGetJob(db, job({ id: 'job_1' }))
  })

  it('appends attempt rows without mutating jobs', async () => {
    const before = await getJob(db, 'job_1', PUBKEY_A)

    await recordAttempt(db, {
      id: 'attempt_1',
      jobId: 'job_1',
      status: 'uploading',
      errorCode: null,
      errorMessage: null,
      providerStatus: 202,
      providerResponseJson: '{"ok":true}',
      createdAt: 2_000,
    })
    await recordAttempt(db, {
      id: 'attempt_2',
      jobId: 'job_1',
      status: 'failed',
      errorCode: 'rate_limited',
      errorMessage: 'try later',
      providerStatus: 429,
      providerResponseJson: '{"error":"rate_limit"}',
      createdAt: 2_100,
    })

    await expect(listAttempts(db, 'job_1')).resolves.toEqual([
      {
        id: 'attempt_1',
        jobId: 'job_1',
        status: 'uploading',
        errorCode: null,
        errorMessage: null,
        providerStatus: 202,
        providerResponseJson: '{"ok":true}',
        createdAt: 2_000,
      },
      {
        id: 'attempt_2',
        jobId: 'job_1',
        status: 'failed',
        errorCode: 'rate_limited',
        errorMessage: 'try later',
        providerStatus: 429,
        providerResponseJson: '{"error":"rate_limit"}',
        createdAt: 2_100,
      },
    ])
    await expect(getJob(db, 'job_1', PUBKEY_A)).resolves.toEqual(before)
  })
})
