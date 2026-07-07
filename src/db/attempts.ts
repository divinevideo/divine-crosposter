import { allPrepared, runPrepared } from './client'
import type { ErrorCode, JobAttemptRecord, JobStatus } from '../types'

type JobAttemptRow = {
  id: string
  job_id: string
  status: JobStatus
  error_code: ErrorCode | null
  error_message: string | null
  provider_status: number | null
  provider_response_json: string | null
  created_at: number
}

function mapAttempt(row: JobAttemptRow): JobAttemptRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    providerStatus: row.provider_status,
    providerResponseJson: row.provider_response_json,
    createdAt: row.created_at,
  }
}

export async function recordAttempt(db: D1Database, input: JobAttemptRecord): Promise<void> {
  await runPrepared(
    db,
    `INSERT INTO job_attempts (
      id, job_id, status, error_code, error_message, provider_status, provider_response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.jobId,
    input.status,
    input.errorCode,
    input.errorMessage,
    input.providerStatus,
    input.providerResponseJson,
    input.createdAt,
  )
}

export async function listAttempts(db: D1Database, jobId: string): Promise<JobAttemptRecord[]> {
  const rows = await allPrepared<JobAttemptRow>(
    db,
    'SELECT * FROM job_attempts WHERE job_id = ? ORDER BY created_at ASC, id ASC',
    jobId,
  )
  return rows.map(mapAttempt)
}
