import { changes, firstPrepared, runPrepared } from './client'
import type { OAuthStateRecord, Platform } from '../types'

type OAuthStateRow = {
  state_id: string
  pubkey: string
  platform: Platform
  code_verifier: string | null
  return_url: string
  created_at: number
  expires_at: number
  metadata_json: string
}

function mapOAuthState(row: OAuthStateRow): OAuthStateRecord {
  return {
    stateId: row.state_id,
    pubkey: row.pubkey,
    platform: row.platform,
    codeVerifier: row.code_verifier,
    returnUrl: row.return_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    metadataJson: row.metadata_json,
  }
}

export async function createOAuthState(db: D1Database, input: OAuthStateRecord): Promise<void> {
  await runPrepared(
    db,
    `INSERT INTO oauth_states (
      state_id, pubkey, platform, code_verifier, return_url, created_at, expires_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.stateId,
    input.pubkey,
    input.platform,
    input.codeVerifier,
    input.returnUrl,
    input.createdAt,
    input.expiresAt,
    input.metadataJson,
  )
}

export async function consumeOAuthState(
  db: D1Database,
  stateId: string,
  now: number,
): Promise<OAuthStateRecord | null> {
  const row = await firstPrepared<OAuthStateRow>(
    db,
    `DELETE FROM oauth_states
    WHERE state_id = ? AND expires_at >= ?
    RETURNING *`,
    stateId,
    now,
  )
  return row ? mapOAuthState(row) : null
}

export async function deleteExpiredOAuthStates(db: D1Database, now: number): Promise<number> {
  const result = await runPrepared(db, 'DELETE FROM oauth_states WHERE expires_at < ?', now)
  return changes(result)
}
