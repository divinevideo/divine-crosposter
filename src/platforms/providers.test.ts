import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstagramAdapter } from './instagram'

describe('provider adapters', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds OAuth URLs with state and redirect URI', () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    const authorizationUrl = new URL(
      adapter.buildAuthorizationUrl({
        state: 'state-id',
        redirectUri: 'https://crossposter.divine.video/connections/instagram/callback',
      }),
    )

    expect(authorizationUrl.origin).toBe('https://www.facebook.com')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client')
    expect(authorizationUrl.searchParams.get('state')).toBe('state-id')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://crossposter.divine.video/connections/instagram/callback',
    )
  })

  it('throws normalized provider errors from provider request failures', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'media_rejected', message: 'media rejected' } }, { status: 400 }),
    )

    await expect(
      adapter.publishVideo({
        accessToken: 'access',
        externalAccountId: 'ig-user',
        videoUrl: 'https://cdn.divine.video/video.mp4',
        mediaHash: 'sha256:abc',
        caption: 'caption',
      }),
    ).rejects.toMatchObject({ code: 'media_rejected', providerStatus: 400, platform: 'instagram' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/ig-user/media',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
