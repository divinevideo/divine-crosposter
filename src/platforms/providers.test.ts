import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstagramAdapter } from './instagram'
import { createTikTokAdapter } from './tiktok'
import { createXAdapter } from './x'
import { createYouTubeAdapter } from './youtube'

const VIDEO_BYTES = new Uint8Array([1, 2, 3, 4])

function publishInput() {
  return {
    accessToken: 'access',
    externalAccountId: 'account-id',
    videoUrl: 'https://cdn.divine.video/video.mp4',
    mediaHash: 'sha256:abc',
    caption: 'caption',
  }
}

function bodyAsParams(call: unknown[]): URLSearchParams {
  const init = call[1] as RequestInit
  return init.body as URLSearchParams
}

async function bodyAsJson(call: unknown[]): Promise<Record<string, unknown>> {
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('provider adapters', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds Instagram-login OAuth URLs with business scopes', () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    const authorizationUrl = new URL(
      adapter.buildAuthorizationUrl({
        state: 'state-id',
        redirectUri: 'https://crossposter.divine.video/connections/instagram/callback',
      }),
    )

    expect(authorizationUrl.origin).toBe('https://www.instagram.com')
    expect(authorizationUrl.pathname).toBe('/oauth/authorize')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client')
    expect(authorizationUrl.searchParams.get('state')).toBe('state-id')
    expect(authorizationUrl.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://crossposter.divine.video/connections/instagram/callback',
    )
  })

  it('exchanges an Instagram code for a long-lived token', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: 'short-token', user_id: 'ig-user-id' }))
      .mockResolvedValueOnce(Response.json({ access_token: 'long-token', token_type: 'bearer', expires_in: 5184000 }))

    const tokens = await adapter.exchangeCallback({
      code: 'auth-code',
      redirectUri: 'https://crossposter.divine.video/connections/instagram/callback',
    })

    expect(tokens.accessToken).toBe('long-token')
    expect(tokens.refreshToken).toBe('long-token')
    expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.instagram.com/oauth/access_token')
    expect(bodyAsParams(fetchMock.mock.calls[0]).get('grant_type')).toBe('authorization_code')
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://graph.instagram.com/access_token')
    expect(String(fetchMock.mock.calls[1][0])).toContain('grant_type=ig_exchange_token')
    expect(String(fetchMock.mock.calls[1][0])).toContain('access_token=short-token')
  })

  it('refreshes a long-lived Instagram token with the ig_refresh_token grant', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({ access_token: 'refreshed-token', token_type: 'bearer', expires_in: 5184000 }),
    )

    const tokens = await adapter.refreshToken({ refreshToken: 'long-token' })

    expect(tokens.accessToken).toBe('refreshed-token')
    expect(tokens.refreshToken).toBe('refreshed-token')
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.instagram.com/refresh_access_token')
    expect(String(fetchMock.mock.calls[0][0])).toContain('grant_type=ig_refresh_token')
    expect(String(fetchMock.mock.calls[0][0])).toContain('access_token=long-token')
  })

  it('throws normalized provider errors from provider request failures', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'media_rejected', message: 'media rejected' } }, { status: 400 }),
    )

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'media_rejected',
      providerStatus: 400,
      platform: 'instagram',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.instagram.com/v23.0/account-id/media',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates an Instagram container, checks status, and waits when not ready', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
      .mockResolvedValueOnce(Response.json({ status_code: 'IN_PROGRESS' }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'processing',
      externalPostId: 'container-id',
      providerResponse: {
        id: 'container-id',
        creationId: 'container-id',
        externalAccountId: 'account-id',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.instagram.com/v23.0/account-id/media',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://graph.instagram.com/v23.0/container-id')
    expect(String(fetchMock.mock.calls[1][0])).toContain('fields=status_code')
  })

  it('publishes an Instagram container only after status is ready', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id' }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'ig-post-id',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://graph.instagram.com/v23.0/account-id/media_publish',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('discovers the Instagram professional account without needing a Facebook Page', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          id: 'app-scoped-id',
          user_id: 'ig-user-id',
          username: 'divinevideo',
          name: 'Divine',
          account_type: 'BUSINESS',
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'container-id' }))
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id' }))

    const account = await adapter.fetchAccount({ accessToken: 'access' })
    expect(account).toMatchObject({
      id: 'ig-user-id',
      name: 'divinevideo',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.instagram.com/v23.0/me')
    expect(String(fetchMock.mock.calls[0][0])).toContain('user_id')

    await adapter.publishVideo({ ...publishInput(), externalAccountId: account.id })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.instagram.com/v23.0/ig-user-id/media',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('polls an Instagram processing container and publishes when finished', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id', permalink: 'https://instagram.com/reel/id' }))

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: {
          creationId: 'container-id',
          externalAccountId: 'account-id',
        },
      }),
    ).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'ig-post-id',
      externalPostUrl: 'https://instagram.com/reel/id',
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.instagram.com/v23.0/container-id')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.instagram.com/v23.0/account-id/media_publish',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('starts TikTok direct post with pull-from-url source info', async () => {
    const adapter = createTikTokAdapter({ clientKey: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          data: {
            privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { publish_id: 'publish-id' } }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'processing',
      externalPostId: 'publish-id',
      providerResponse: {
        publish_id: 'publish-id',
        data: { publish_id: 'publish-id' },
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      }),
    )
    await expect(bodyAsJson(fetchMock.mock.calls[1])).resolves.toMatchObject({
      source_info: { source: 'PULL_FROM_URL', video_url: 'https://cdn.divine.video/video.mp4' },
      post_info: { title: 'caption', brand_content_toggle: false, brand_organic_toggle: false },
    })
  })

  it('rejects TikTok HTTP 200 responses with provider error codes', async () => {
    const adapter = createTikTokAdapter({ clientKey: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        error: {
          code: 'access_token_invalid',
          message: 'access token is invalid',
        },
      }),
    )

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'needs_reauth',
      providerStatus: 200,
      platform: 'tiktok',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('polls TikTok nested status responses by publish id', async () => {
    const adapter = createTikTokAdapter({ clientKey: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(Response.json({ data: { status: 'PUBLISH_COMPLETE' } }))

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: { data: { publish_id: 'publish-id' } },
      }),
    ).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'publish-id',
      providerResponse: { data: { status: 'PUBLISH_COMPLETE' } },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      }),
    )
    await expect(bodyAsJson(fetchMock.mock.calls[0])).resolves.toEqual({ publish_id: 'publish-id' })
  })

  it('maps TikTok creator-info without private visibility support to platform review required', async () => {
    const adapter = createTikTokAdapter({ clientKey: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          privacy_level_options: ['FOLLOWER_OF_CREATOR'],
        },
      }),
    )

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'platform_review_required',
      platform: 'tiktok',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uploads X video bytes with INIT, APPEND, FINALIZE, then creates a post', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'tweet-id' } }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'tweet-id',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://cdn.divine.video/video.mp4')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.x.com/2/media/upload')
    expect(bodyAsParams(fetchMock.mock.calls[1]).get('command')).toBe('INIT')
    expect(bodyAsParams(fetchMock.mock.calls[1]).get('total_bytes')).toBe(String(VIDEO_BYTES.byteLength))
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://api.x.com/2/media/upload/media-id/append')
    await expect(bodyAsJson(fetchMock.mock.calls[2])).resolves.toMatchObject({
      media: expect.any(String),
      segment_index: 0,
    })
    expect(String(fetchMock.mock.calls[3][0])).toBe('https://api.x.com/2/media/upload/media-id/finalize')
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.x.com/2/tweets',
      expect.objectContaining({ method: 'POST' }),
    )
    await expect(bodyAsJson(fetchMock.mock.calls[4])).resolves.toMatchObject({
      text: 'caption',
      media: { media_ids: ['media-id'] },
    })
  })

  it('returns processing for X finalize processing_info and posts after status succeeds', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', processing_info: { state: 'pending' } } }))

    const processing = await adapter.publishVideo(publishInput())
    expect(processing).toMatchObject({ status: 'processing', externalPostId: 'media-id' })
    expect(fetchMock).toHaveBeenCalledTimes(4)

    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', processing_info: { state: 'succeeded' } } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'tweet-id' } }))

    await expect(
      adapter.pollPublishStatus?.({ accessToken: 'access', providerResponse: processing.providerResponse }),
    ).resolves.toMatchObject({ status: 'posted', externalPostId: 'tweet-id' })

    expect(String(fetchMock.mock.calls[4][0])).toBe('https://api.x.com/2/media/upload?command=STATUS&media_id=media-id')
    await expect(bodyAsJson(fetchMock.mock.calls[5])).resolves.toMatchObject({
      text: 'caption',
      media: { media_ids: ['media-id'] },
    })
  })

  it('uploads YouTube through resumable metadata start and media upload calls', async () => {
    const adapter = createYouTubeAdapter({ clientId: 'client', clientSecret: 'secret', defaultPrivacyStatus: 'unlisted' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://upload.youtube/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'youtube-id',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://cdn.divine.video/video.mp4')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer access',
          'content-type': 'application/json',
          'x-upload-content-type': 'video/mp4',
          'x-upload-content-length': String(VIDEO_BYTES.byteLength),
        }),
      }),
    )
    await expect(bodyAsJson(fetchMock.mock.calls[1])).resolves.toMatchObject({
      snippet: { title: 'caption', description: 'caption' },
      status: { privacyStatus: 'unlisted' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://upload.youtube/session',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          authorization: 'Bearer access',
          'content-type': 'video/mp4',
          'content-length': String(VIDEO_BYTES.byteLength),
        }),
      }),
    )
  })

  it('uses private YouTube privacy by default', async () => {
    const adapter = createYouTubeAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://upload.youtube/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))

    await adapter.publishVideo(publishInput())

    await expect(bodyAsJson(fetchMock.mock.calls[1])).resolves.toMatchObject({
      status: { privacyStatus: 'private' },
    })
  })

  it('requests YouTube offline consent for refresh tokens', () => {
    const adapter = createYouTubeAdapter({ clientId: 'client', clientSecret: 'secret' })
    const authorizationUrl = new URL(
      adapter.buildAuthorizationUrl({
        state: 'state-id',
        redirectUri: 'https://crossposter.divine.video/connections/youtube/callback',
      }),
    )

    expect(authorizationUrl.searchParams.get('access_type')).toBe('offline')
    expect(authorizationUrl.searchParams.get('prompt')).toBe('consent')
  })
})
