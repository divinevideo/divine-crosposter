import { allPrepared, changes, firstPrepared, runPrepared } from './client'
import type { CreateJobInput, ErrorCode, JobRecord, JobStatus, Platform, UpdateJobStatusInput } from '../types'

type JobRow = {
  id: string
  pubkey: string
  video_event_id: string
  platform: Platform
  connection_id: string
  external_account_id: string
  source_media_url: string
  source_media_hash: string
  caption: string
  status: JobStatus
  error_code: ErrorCode | null
  error_message: string | null
  external_post_id: string | null
  external_post_url: string | null
  retry_count: number
  next_retry_at: number | null
  expires_at: number
  created_at: number
  updated_at: number
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    pubkey: row.pubkey,
    videoEventId: row.video_event_id,
    platform: row.platform,
    connectionId: row.connection_id,
    externalAccountId: row.external_account_id,
    sourceMediaUrl: row.source_media_url,
    sourceMediaHash: row.source_media_hash,
    caption: row.caption,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    externalPostId: row.external_post_id,
    externalPostUrl: row.external_post_url,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function findByIdempotencyKey(db: D1Database, input: CreateJobInput): Promise<JobRecord | null> {
  const row = await firstPrepared<JobRow>(
    db,
    `SELECT * FROM jobs
    WHERE pubkey = ? AND video_event_id = ? AND platform = ? AND external_account_id = ?`,
    input.pubkey,
    input.videoEventId,
    input.platform,
    input.externalAccountId,
  )
  return row ? mapJob(row) : null
}

export async function createOrGetJob(
  db: D1Database,
  input: CreateJobInput,
): Promise<{ job: JobRecord; created: boolean }> {
  const existing = await findByIdempotencyKey(db, input)
  if (existing) {
    return { job: existing, created: false }
  }

  const result = await runPrepared(
    db,
    `INSERT OR IGNORE INTO jobs (
      id, pubkey, video_event_id, platform, connection_id, external_account_id,
      source_media_url, source_media_hash, caption, status, error_code, error_message,
      external_post_id, external_post_url, retry_count, next_retry_at, expires_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.pubkey,
    input.videoEventId,
    input.platform,
    input.connectionId,
    input.externalAccountId,
    input.sourceMediaUrl,
    input.sourceMediaHash,
    input.caption,
    input.status,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.externalPostId ?? null,
    input.externalPostUrl ?? null,
    input.retryCount ?? 0,
    input.nextRetryAt ?? null,
    input.expiresAt,
    input.createdAt,
    input.updatedAt,
  )

  const job = changes(result) > 0 ? await getJob(db, input.id) : await findByIdempotencyKey(db, input)
  if (!job) {
    throw new Error('failed to create or find job')
  }
  return { job, created: changes(result) > 0 }
}

export async function listJobsForVideo(
  db: D1Database,
  pubkey: string,
  videoEventId: string,
): Promise<JobRecord[]> {
  const rows = await allPrepared<JobRow>(
    db,
    `SELECT * FROM jobs
    WHERE pubkey = ? AND video_event_id = ?
    ORDER BY created_at ASC, id ASC`,
    pubkey,
    videoEventId,
  )
  return rows.map(mapJob)
}

export async function getJob(db: D1Database, id: string, pubkey?: string): Promise<JobRecord | null> {
  const row = pubkey
    ? await firstPrepared<JobRow>(db, 'SELECT * FROM jobs WHERE id = ? AND pubkey = ?', id, pubkey)
    : await firstPrepared<JobRow>(db, 'SELECT * FROM jobs WHERE id = ?', id)
  return row ? mapJob(row) : null
}

export async function updateJobStatus(db: D1Database, input: UpdateJobStatusInput): Promise<void> {
  const assignments = ['status = ?', 'updated_at = ?']
  const bindings: unknown[] = [input.status, input.updatedAt]

  const nullableFields = [
    ['errorCode', 'error_code'],
    ['errorMessage', 'error_message'],
    ['externalPostId', 'external_post_id'],
    ['externalPostUrl', 'external_post_url'],
    ['nextRetryAt', 'next_retry_at'],
  ] as const

  for (const [inputKey, column] of nullableFields) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey)) {
      assignments.push(`${column} = ?`)
      bindings.push(input[inputKey])
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'retryCount')) {
    assignments.push('retry_count = ?')
    bindings.push(input.retryCount)
  }

  bindings.push(input.id)
  await runPrepared(db, `UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`, ...bindings)
}

export async function claimJobForPublish(db: D1Database, id: string, now: number): Promise<JobRecord | null> {
  const row = await firstPrepared<JobRow>(
    db,
    `UPDATE jobs
    SET status = 'uploading', updated_at = ?, error_code = NULL, error_message = NULL
    WHERE id = ?
      AND status IN ('queued', 'failed')
      AND expires_at > ?
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    RETURNING *`,
    now,
    id,
    now,
    now,
  )
  return row ? mapJob(row) : null
}

export async function claimJobForStatusPoll(db: D1Database, id: string, now: number): Promise<JobRecord | null> {
  const row = await firstPrepared<JobRow>(
    db,
    `UPDATE jobs
    SET status = 'uploading', updated_at = ?, error_code = NULL, error_message = NULL
    WHERE id = ?
      AND status = 'processing'
      AND expires_at > ?
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    RETURNING *`,
    now,
    id,
    now,
    now,
  )
  return row ? mapJob(row) : null
}

export async function transitionClaimToDispatching(
  db: D1Database,
  id: string,
  claimUpdatedAt: number,
  now: number,
): Promise<boolean> {
  const row = await firstPrepared<{ id: string }>(
    db,
    `UPDATE jobs
    SET status = 'dispatching', updated_at = ?, error_code = NULL, error_message = NULL, next_retry_at = NULL
    WHERE id = ?
      AND status = 'uploading'
      AND updated_at = ?
    RETURNING id`,
    now,
    id,
    claimUpdatedAt,
  )
  return row !== null
}

export async function listRunnableJobs(db: D1Database, now: number, limit: number): Promise<JobRecord[]> {
  const rows = await allPrepared<JobRow>(
    db,
    `SELECT * FROM jobs
    WHERE status IN ('queued', 'failed')
      AND expires_at > ?
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY COALESCE(next_retry_at, created_at) ASC, created_at ASC
    LIMIT ?`,
    now,
    now,
    limit,
  )
  return rows.map(mapJob)
}
