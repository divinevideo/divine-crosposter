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

  it('uses atomic delete-returning semantics so concurrent consumes only return one state', async () => {
    const row = {
      state_id: 'state_atomic',
      pubkey: PUBKEY_A,
      platform: 'youtube',
      code_verifier: 'verifier',
      return_url: 'https://divine.video/settings/crossposting',
      created_at: 1_000,
      expires_at: 2_000,
      metadata_json: '{}',
    }
    let deleted = false
    const atomicDb = {
      prepare(query: string) {
        if (!query.includes('DELETE FROM oauth_states') || !query.includes('RETURNING')) {
          throw new Error('oauth state consumption must be a single atomic DELETE RETURNING query')
        }

        return {
          bind() {
            return {
              async first() {
                if (deleted) {
                  return null
                }
                deleted = true
                return row
              },
            }
          },
        }
      },
    } as unknown as D1Database

    const [first, second] = await Promise.all([
      consumeOAuthState(atomicDb, 'state_atomic', 1_500),
      consumeOAuthState(atomicDb, 'state_atomic', 1_500),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect([first, second]).toContainEqual({
      stateId: 'state_atomic',
      pubkey: PUBKEY_A,
      platform: 'youtube',
      codeVerifier: 'verifier',
      returnUrl: 'https://divine.video/settings/crossposting',
      createdAt: 1_000,
      expiresAt: 2_000,
      metadataJson: '{}',
    })
    expect([first, second]).toContain(null)
  })
})
