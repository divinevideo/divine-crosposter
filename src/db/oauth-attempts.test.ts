import { beforeEach, describe, expect, it } from 'vitest'
import {
  createOAuthAttempt,
  expireStartedOAuthAttempts,
  getOAuthAttempt,
  updateOAuthAttempt,
} from './oauth-attempts'
import { applyMigrations, PUBKEY_A } from './test-helpers'

describe('oauth attempt repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
  })

  it('persists a sanitized OAuth attempt lifecycle transition', async () => {
    await createOAuthAttempt(db, {
      id: 'attempt_1',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'started',
      failureCode: null,
      providerStatus: null,
      createdAt: 1_000,
      expiresAt: 1_600,
      updatedAt: 1_000,
    })

    await updateOAuthAttempt(db, {
      id: 'attempt_1',
      status: 'token_exchange_failed',
      failureCode: 'token_exchange_failed',
      providerStatus: 401,
      updatedAt: 1_100,
    })

    await expect(getOAuthAttempt(db, 'attempt_1')).resolves.toEqual({
      id: 'attempt_1',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'token_exchange_failed',
      failureCode: 'token_exchange_failed',
      providerStatus: 401,
      createdAt: 1_000,
      expiresAt: 1_600,
      updatedAt: 1_100,
    })
  })

  it('expires only overdue started attempts', async () => {
    await createOAuthAttempt(db, {
      id: 'attempt_overdue_started',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'started',
      failureCode: null,
      providerStatus: null,
      createdAt: 1_000,
      expiresAt: 1_100,
      updatedAt: 1_000,
    })
    await createOAuthAttempt(db, {
      id: 'attempt_active_started',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'started',
      failureCode: null,
      providerStatus: null,
      createdAt: 1_000,
      expiresAt: 2_000,
      updatedAt: 1_000,
    })
    await createOAuthAttempt(db, {
      id: 'attempt_overdue_connected',
      pubkey: PUBKEY_A,
      platform: 'x',
      status: 'connected',
      failureCode: null,
      providerStatus: null,
      createdAt: 1_000,
      expiresAt: 1_100,
      updatedAt: 1_000,
    })

    await expect(expireStartedOAuthAttempts(db, 1_200)).resolves.toBe(1)

    await expect(getOAuthAttempt(db, 'attempt_overdue_started')).resolves.toMatchObject({
      status: 'expired',
      failureCode: null,
      providerStatus: null,
      updatedAt: 1_200,
    })
    await expect(getOAuthAttempt(db, 'attempt_active_started')).resolves.toMatchObject({
      status: 'started',
      updatedAt: 1_000,
    })
    await expect(getOAuthAttempt(db, 'attempt_overdue_connected')).resolves.toMatchObject({
      status: 'connected',
      updatedAt: 1_000,
    })
  })
})
