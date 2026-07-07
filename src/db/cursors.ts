import { firstPrepared, runPrepared } from './client'
import type { AutoCursorRecord } from '../types'

type AutoCursorRow = {
  pubkey: string
  cursor: string | null
  last_checked_at: number
  updated_at: number
}

function mapCursor(row: AutoCursorRow): AutoCursorRecord {
  return {
    pubkey: row.pubkey,
    cursor: row.cursor,
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
  }
}

export async function getCursor(db: D1Database, pubkey: string): Promise<AutoCursorRecord | null> {
  const row = await firstPrepared<AutoCursorRow>(db, 'SELECT * FROM auto_cursors WHERE pubkey = ?', pubkey)
  return row ? mapCursor(row) : null
}

export async function upsertCursor(db: D1Database, input: AutoCursorRecord): Promise<void> {
  await runPrepared(
    db,
    `INSERT INTO auto_cursors (pubkey, cursor, last_checked_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(pubkey) DO UPDATE SET
      cursor = excluded.cursor,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at`,
    input.pubkey,
    input.cursor,
    input.lastCheckedAt,
    input.updatedAt,
  )
}
