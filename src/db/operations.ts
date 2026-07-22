import { changes, firstPrepared, runPrepared } from './client'

type OperationsAlertTestRow = {
  id: string
  requested_at: number
}

export type OperationsAlertTestRequest = {
  id: string
  requestedAt: number
}

export async function countOverdueRunnableJobs(
  db: D1Database,
  now: number,
  graceSeconds: number,
): Promise<number> {
  const row = await firstPrepared<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count
    FROM jobs
    WHERE status IN ('queued', 'failed', 'processing')
      AND expires_at > ?
      AND COALESCE(next_retry_at, created_at) <= ?`,
    now,
    now - graceSeconds,
  )
  return row?.count ?? 0
}

export async function requestOperationsAlertTest(db: D1Database, id: string, requestedAt: number): Promise<void> {
  await runPrepared(
    db,
    'INSERT INTO operations_alert_tests (id, requested_at, consumed_at) VALUES (?, ?, NULL)',
    id,
    requestedAt,
  )
}

export async function getOldestUnconsumedAlertTest(db: D1Database): Promise<OperationsAlertTestRequest | null> {
  const row = await firstPrepared<OperationsAlertTestRow>(
    db,
    `SELECT id, requested_at
    FROM operations_alert_tests
    WHERE consumed_at IS NULL
    ORDER BY requested_at ASC, id ASC
    LIMIT 1`,
  )
  return row ? { id: row.id, requestedAt: row.requested_at } : null
}

export async function markAlertTestConsumed(db: D1Database, id: string, consumedAt: number): Promise<boolean> {
  const result = await runPrepared(
    db,
    `UPDATE operations_alert_tests
    SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL`,
    consumedAt,
    id,
  )
  return changes(result) > 0
}
