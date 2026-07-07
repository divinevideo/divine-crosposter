import { allPrepared, firstPrepared, runPrepared } from './client'
import type { Platform, PreferenceMode, PreferenceRecord } from '../types'

type PreferenceRow = {
  pubkey: string
  platform: Platform
  connection_id: string | null
  mode: PreferenceMode
  automatic_enabled_at: number | null
  created_at: number
  updated_at: number
}

function mapPreference(row: PreferenceRow): PreferenceRecord {
  return {
    pubkey: row.pubkey,
    platform: row.platform,
    connectionId: row.connection_id,
    mode: row.mode,
    automaticEnabledAt: row.automatic_enabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getPreferences(db: D1Database, pubkey: string): Promise<PreferenceRecord[]> {
  const rows = await allPrepared<PreferenceRow>(
    db,
    'SELECT * FROM preferences WHERE pubkey = ? ORDER BY platform ASC',
    pubkey,
  )
  return rows.map(mapPreference)
}

export async function setPreference(db: D1Database, input: PreferenceRecord): Promise<PreferenceRecord> {
  const automaticEnabledAt = input.mode === 'automatic' ? input.automaticEnabledAt ?? input.updatedAt : null

  await runPrepared(
    db,
    `INSERT INTO preferences (
      pubkey, platform, connection_id, mode, automatic_enabled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey, platform) DO UPDATE SET
      connection_id = excluded.connection_id,
      mode = excluded.mode,
      automatic_enabled_at = excluded.automatic_enabled_at,
      updated_at = excluded.updated_at`,
    input.pubkey,
    input.platform,
    input.connectionId,
    input.mode,
    automaticEnabledAt,
    input.createdAt,
    input.updatedAt,
  )

  const row = await firstPrepared<PreferenceRow>(
    db,
    'SELECT * FROM preferences WHERE pubkey = ? AND platform = ?',
    input.pubkey,
    input.platform,
  )
  if (!row) {
    throw new Error('failed to set preference')
  }
  return mapPreference(row)
}

export async function listAutomaticPreferences(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<PreferenceRecord[]> {
  const rows = await allPrepared<PreferenceRow>(
    db,
    `SELECT * FROM preferences
    WHERE mode = 'automatic'
    ORDER BY updated_at ASC, pubkey ASC, platform ASC
    LIMIT ? OFFSET ?`,
    limit,
    offset,
  )
  return rows.map(mapPreference)
}
