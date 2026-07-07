import { beforeEach, describe, expect, it } from 'vitest'
import { createOAuthState, consumeOAuthState, deleteExpiredOAuthStates } from './oauth-states'
import { applyMigrations, PUBKEY_A } from './test-helpers'

describe('oauth state repository', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await applyMigrations()
  })

  it('consumes a state once', async () => {
    await createOAuthState(db, {
      stateId: 'state_1',
      pubkey: PUBKEY_A,
      platform: 'youtube',
      codeVerifier: 'verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 2_000,
      metadataJson: '{"nonce":"one"}',
    })

    const consumed = await consumeOAuthState(db, 'state_1', 1_500)
    const consumedAgain = await consumeOAuthState(db, 'state_1', 1_500)

    expect(consumed).toEqual({
      stateId: 'state_1',
      pubkey: PUBKEY_A,
      platform: 'youtube',
      codeVerifier: 'verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 2_000,
      metadataJson: '{"nonce":"one"}',
    })
    expect(consumedAgain).toBeNull()
  })

  it('does not consume expired states and can delete them', async () => {
    await createOAuthState(db, {
      stateId: 'state_expired',
      pubkey: PUBKEY_A,
      platform: 'instagram',
      codeVerifier: null,
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 1_100,
      metadataJson: '{}',
    })

    await expect(consumeOAuthState(db, 'state_expired', 1_101)).resolves.toBeNull()
    await expect(deleteExpiredOAuthStates(db, 1_101)).resolves.toBe(1)
  })
})
