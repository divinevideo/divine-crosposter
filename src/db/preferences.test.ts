import { beforeEach, describe, expect, it } from 'vitest'
import { upsertConnection } from './connections'
import { getPreferences, listAutomaticPreferences, setPreference } from './preferences'
import { applyMigrations, connection, PUBKEY_A } from './test-helpers'

describe('preference repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
    await upsertConnection(db, connection({ id: 'conn_tiktok' }))
  })

  it('stores automatic_enabled_at when mode is automatic', async () => {
    const preference = await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'automatic',
      automaticEnabledAt: 2_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    })

    expect(preference).toMatchObject({ mode: 'automatic', automaticEnabledAt: 2_000 })
    await expect(getPreferences(db, PUBKEY_A)).resolves.toEqual([preference])
    await expect(listAutomaticPreferences(db, 10, 0)).resolves.toEqual([preference])
  })

  it('clears automatic_enabled_at for non-automatic modes', async () => {
    await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'automatic',
      automaticEnabledAt: 2_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    })

    const manual = await setPreference(db, {
      pubkey: PUBKEY_A,
      platform: 'tiktok',
      connectionId: 'conn_tiktok',
      mode: 'manual',
      automaticEnabledAt: 3_000,
      createdAt: 1_000,
      updatedAt: 3_000,
    })

    expect(manual).toMatchObject({ mode: 'manual', automaticEnabledAt: null })
    await expect(listAutomaticPreferences(db, 10, 0)).resolves.toEqual([])
  })
})
