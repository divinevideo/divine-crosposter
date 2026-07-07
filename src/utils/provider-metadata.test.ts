import { describe, expect, it } from 'vitest'
import { sanitizeProviderMetadata } from './provider-metadata'

describe('provider metadata sanitization', () => {
  it('removes token-like fields recursively while keeping safe metadata', () => {
    expect(
      sanitizeProviderMetadata({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        nested: {
          authorizationHeader: 'Bearer access',
          display_name: 'Divine',
        },
        accounts: [{ client_secret: 'secret', id: 'account-1' }],
      }),
    ).toEqual({
      expires_in: 3600,
      nested: { display_name: 'Divine' },
      accounts: [{ id: 'account-1' }],
    })
  })
})
