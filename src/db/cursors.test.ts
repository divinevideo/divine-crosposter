import { beforeEach, describe, expect, it } from 'vitest'
import { getCursor, upsertCursor } from './cursors'
import { applyMigrations, PUBKEY_A } from './test-helpers'

describe('cursor repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
  })

  it('overwrites cursor state for the same pubkey', async () => {
    await upsertCursor(db, {
      pubkey: PUBKEY_A,
      cursor: 'cursor-1',
      lastCheckedAt: 1_000,
      updatedAt: 1_000,
    })
    await upsertCursor(db, {
      pubkey: PUBKEY_A,
      cursor: 'cursor-2',
      lastCheckedAt: 2_000,
      updatedAt: 2_000,
    })

    await expect(getCursor(db, PUBKEY_A)).resolves.toEqual({
      pubkey: PUBKEY_A,
      cursor: 'cursor-2',
      lastCheckedAt: 2_000,
      updatedAt: 2_000,
    })
  })
})
