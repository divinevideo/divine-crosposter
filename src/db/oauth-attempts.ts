import { changes, firstPrepared, runPrepared } from './client'
import type {
  OAuthAttemptFailureCode,
  OAuthAttemptRecord,
  OAuthAttemptStatus,
  Platform,
  UpdateOAuthAttemptInput,
} from '../types'

type OAuthAttemptRow = {
  id: string
  pubkey: string
  platform: Platform
  status: OAuthAttemptStatus
  failure_code: OAuthAttemptFailureCode | null
  provider_status: number | null
  created_at: number
  expires_at: number
  updated_at: number
}

function mapOAuthAttempt(row: OAuthAttemptRow): OAuthAttemptRecord {
  return {
    id: row.id,
    pubkey: row.pubkey,
    platform: row.platform,
    status: row.status,
    failureCode: row.failure_code,
    providerStatus: row.provider_status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }
}

export async function createOAuthAttempt(
  db: D1Database,
  input: OAuthAttemptRecord,
): Promise<void> {
  await runPrepared(
    db,
    `INSERT INTO oauth_attempts (
      id, pubkey, platform, status, failure_code, provider_status, created_at, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.pubkey,
    input.platform,
    input.status,
    input.failureCode,
    input.providerStatus,
    input.createdAt,
    input.expiresAt,
    input.updatedAt,
  )
}

export async function getOAuthAttempt(
  db: D1Database,
  id: string,
): Promise<OAuthAttemptRecord | null> {
  const row = await firstPrepared<OAuthAttemptRow>(
    db,
    'SELECT * FROM oauth_attempts WHERE id = ?',
    id,
  )
  return row ? mapOAuthAttempt(row) : null
}

export async function updateOAuthAttempt(
  db: D1Database,
  input: UpdateOAuthAttemptInput,
): Promise<void> {
  await runPrepared(
    db,
    `UPDATE oauth_attempts
    SET status = ?, failure_code = ?, provider_status = ?, updated_at = ?
    WHERE id = ?`,
    input.status,
    input.failureCode,
    input.providerStatus,
    input.updatedAt,
    input.id,
  )
}

export async function expireStartedOAuthAttempts(db: D1Database, now: number): Promise<number> {
  const result = await runPrepared(
    db,
    `UPDATE oauth_attempts
    SET status = 'expired', failure_code = NULL, provider_status = NULL, updated_at = ?
    WHERE status = 'started' AND expires_at < ?`,
    now,
    now,
  )
  return changes(result)
}
