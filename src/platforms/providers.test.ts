import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVideoBytes, PlatformAdapterError } from './adapter'
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

function bodyAsFormData(call: unknown[]): FormData {
  const init = call[1] as RequestInit
  expect(init.body).toBeInstanceOf(FormData)
  return init.body as FormData
}

function formText(form: FormData, name: string): string | null {
  const value = form.get(name)
  return typeof value === 'string' ? value : null
}

function formBlob(form: FormData, name: string): Blob {
  const value: unknown = form.get(name)
  expect(value).toBeInstanceOf(Blob)
  if (!(value instanceof Blob)) throw new Error(`${name} is not a Blob`)
  return value
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
      .mockResolvedValueOnce(Response.json({ permalink: 'https://instagram.com/reel/id' }))

    await expect(adapter.publishVideo(publishInput())).resolves.toMatchObject({
      status: 'posted',
      externalPostId: 'ig-post-id',
      externalPostUrl: 'https://instagram.com/reel/id',
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://graph.instagram.com/v23.0/account-id/media_publish',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(String(fetchMock.mock.calls[3][0])).toContain('https://graph.instagram.com/v23.0/ig-post-id')
    expect(String(fetchMock.mock.calls[3][0])).toContain('fields=permalink')
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
      .mockResolvedValueOnce(Response.json({ permalink: 'https://instagram.com/reel/id' }))

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

  it('fails an Instagram container that reports an error status', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({ status_code: 'ERROR', status: 'Error: video format not supported.' }),
    )

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: { creationId: 'container-id', externalAccountId: 'account-id' },
      }),
    ).rejects.toMatchObject({
      code: 'media_rejected',
      platform: 'instagram',
    })
  })

  it('polls an Instagram processing container and publishes when finished', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id' }))
      .mockResolvedValueOnce(Response.json({ permalink: 'https://instagram.com/reel/id' }))

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
    expect(String(fetchMock.mock.calls[2][0])).toContain('https://graph.instagram.com/v23.0/ig-post-id')
    expect(String(fetchMock.mock.calls[2][0])).toContain('fields=permalink')
  })

  it('keeps an Instagram post successful when permalink lookup fails after publication', async () => {
    const adapter = createInstagramAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(Response.json({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ id: 'ig-post-id' }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'temporary lookup failure' } }, { status: 503 }))

    const result = await adapter.pollPublishStatus?.({
      accessToken: 'access',
      providerResponse: {
        creationId: 'container-id',
        externalAccountId: 'account-id',
      },
    })

    expect(result).toMatchObject({ status: 'posted', externalPostId: 'ig-post-id' })
    expect(result?.externalPostUrl).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
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

  describe('X OAuth', () => {
    const callbackInput = {
      code: 'authorization-code',
      redirectUri: 'https://crossposter.divine.video/connections/x/callback',
      codeVerifier: 'pkce-code-verifier',
    }

    it('builds the authorization URL with the production redirect, state, PKCE challenge, and scopes', () => {
      const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
      const authorizationUrl = new URL(
        adapter.buildAuthorizationUrl({
          state: 'oauth-state',
          redirectUri: callbackInput.redirectUri,
          codeChallenge: 'pkce-code-challenge',
        }),
      )

      expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(callbackInput.redirectUri)
      expect(authorizationUrl.searchParams.get('state')).toBe('oauth-state')
      expect(authorizationUrl.searchParams.get('code_challenge')).toBe('pkce-code-challenge')
      expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
      expect(new Set(authorizationUrl.searchParams.get('scope')?.split(' '))).toEqual(
        new Set(['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']),
      )
    })

    it('exchanges a callback using confidential-client form authentication and parses the token response', async () => {
      const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
      const tokenResponse = {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 7200,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
      }
      fetchMock.mockResolvedValueOnce(Response.json(tokenResponse))

      await expect(adapter.exchangeCallback(callbackInput)).resolves.toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: expect.any(Number),
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
        metadata: tokenResponse,
      })

      expect.soft(fetchMock).toHaveBeenCalledWith(
        'https://api.x.com/2/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            authorization: 'Basic Y2xpZW50OnNlY3JldA==',
            'content-type': 'application/x-www-form-urlencoded',
          },
        }),
      )
      expect(Object.fromEntries(bodyAsParams(fetchMock.mock.calls[0]))).toEqual({
        client_id: 'client',
        grant_type: 'authorization_code',
        redirect_uri: callbackInput.redirectUri,
        code: 'authorization-code',
        code_verifier: 'pkce-code-verifier',
      })
    })

    it('refreshes using confidential-client form authentication and parses the token response', async () => {
      const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
      fetchMock.mockResolvedValueOnce(
        Response.json({ access_token: 'refreshed-access-token', refresh_token: 'next-refresh-token' }),
      )

      await expect(adapter.refreshToken({ refreshToken: 'refresh-token' })).resolves.toMatchObject({
        accessToken: 'refreshed-access-token',
        refreshToken: 'next-refresh-token',
      })

      expect.soft(fetchMock).toHaveBeenCalledWith(
        'https://api.x.com/2/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            authorization: 'Basic Y2xpZW50OnNlY3JldA==',
            'content-type': 'application/x-www-form-urlencoded',
          },
        }),
      )
      expect(Object.fromEntries(bodyAsParams(fetchMock.mock.calls[0]))).toEqual({
        client_id: 'client',
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
      })
    })

    it.each([
      ['missing', { provider_secret: 'missing-access-token-sentinel' }],
      ['empty', { access_token: '', provider_secret: 'empty-access-token-sentinel' }],
    ])('rejects a 200 token response with %s access_token without exposing its body', async (_case, tokenResponse) => {
      const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
      fetchMock.mockResolvedValueOnce(Response.json(tokenResponse))

      const error = await adapter.exchangeCallback(callbackInput).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(PlatformAdapterError)
      expect(error).toMatchObject({
        platform: 'x',
        code: 'unknown_platform_error',
        providerStatus: 200,
        providerResponse: undefined,
      })
      expect(String((error as Error).message)).toBe('X token response missing access token')
      expect(JSON.stringify(error)).not.toContain('access-token-sentinel')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('https://api.x.com/2/oauth2/token', expect.any(Object))
    })
  })

  it('exports the X upload chunk size as exactly 5 MiB', async () => {
    await expect(import('./x')).resolves.toMatchObject({
      X_UPLOAD_CHUNK_BYTES: 5 * 1024 * 1024,
      X_MAX_VIDEO_BYTES: 32 * 1024 * 1024,
    })
  })

  it('uploads X video bytes with v2 multipart INIT, APPEND, FINALIZE, then creates a post behind the fence', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    const events: string[] = []
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: '  media-id  ', init_secret: 'init-sentinel' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', finalize_secret: 'finalize-sentinel' } }))
      .mockImplementationOnce(async () => {
        events.push('tweet-fetch')
        return Response.json({ data: { id: '  tweet-id  ', tweet_secret: 'tweet-sentinel' } })
      })

    await expect(
      adapter.publishVideo({
        ...publishInput(),
        beforeExternalPost: async () => {
          events.push('fence')
        },
      }),
    ).resolves.toEqual({
      status: 'posted',
      externalPostId: 'tweet-id',
      externalPostUrl: 'https://x.com/i/web/status/tweet-id',
      providerResponse: {},
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://cdn.divine.video/video.mp4')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.x.com/2/media/upload')
    const init = bodyAsFormData(fetchMock.mock.calls[1])
    expect(
      Object.fromEntries([...init.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    ).toEqual({
      command: 'INIT',
      total_bytes: String(VIDEO_BYTES.byteLength),
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    })
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).has('content-type')).toBe(false)

    expect(String(fetchMock.mock.calls[2][0])).toBe('https://api.x.com/2/media/upload')
    const append = bodyAsFormData(fetchMock.mock.calls[2])
    expect(formText(append, 'command')).toBe('APPEND')
    expect(formText(append, 'media_id')).toBe('media-id')
    expect(formText(append, 'segment_index')).toBe('0')
    const media = formBlob(append, 'media')
    expect(media.size).toBe(VIDEO_BYTES.byteLength)
    expect(Reflect.get(media, 'name')).toBe('video-chunk')
    expect(new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers).has('content-type')).toBe(false)

    expect(String(fetchMock.mock.calls[3][0])).toBe('https://api.x.com/2/media/upload')
    const finalize = bodyAsFormData(fetchMock.mock.calls[3])
    expect(Object.fromEntries(finalize.entries())).toEqual({ command: 'FINALIZE', media_id: 'media-id' })
    expect(new Headers((fetchMock.mock.calls[3][1] as RequestInit).headers).has('content-type')).toBe(false)
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.x.com/2/tweets',
      expect.objectContaining({ method: 'POST' }),
    )
    await expect(bodyAsJson(fetchMock.mock.calls[4])).resolves.toMatchObject({
      text: 'caption',
      media: { media_ids: ['media-id'] },
    })
    expect(events).toEqual(['fence', 'tweet-fetch'])
  })

  it('splits X APPEND multipart media into bounded sequential 5 MiB chunks', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1)
    fetchMock
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'tweet-id' } }))

    await adapter.publishVideo({ ...publishInput(), beforeExternalPost: async () => undefined })

    const appends = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined
      return init?.body instanceof FormData && formText(init.body, 'command') === 'APPEND'
    })
    expect(appends).toHaveLength(2)
    expect(appends.map((call) => formText(bodyAsFormData(call), 'segment_index'))).toEqual(['0', '1'])
    expect(appends.map((call) => formBlob(bodyAsFormData(call), 'media').size)).toEqual([5 * 1024 * 1024, 1])
  })

  it('rejects an X source whose declared content length exceeds the worker-safe limit before reading it', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    const { X_MAX_VIDEO_BYTES } = await import('./x')
    const response = new Response(new Uint8Array([1]), {
      headers: { 'content-length': String(X_MAX_VIDEO_BYTES + 1), 'content-type': 'video/mp4' },
    })
    fetchMock.mockResolvedValueOnce(response)

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'media_rejected',
      platform: 'x',
      providerResponse: undefined,
    })
    expect(response.bodyUsed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels an X source stream when a missing or lying content length exceeds the bound', async () => {
    const chunk = new Uint8Array([1, 2])
    let chunksSent = 0
    let cancelled = false
    const chunksUntilOverLimit = 3
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksSent === chunksUntilOverLimit) {
          controller.close()
          return
        }
        chunksSent += 1
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { 'content-length': '1', 'content-type': 'video/mp4' } }),
    )

    await expect(fetchVideoBytes('x', 'https://cdn.divine.video/stream.mp4', 4)).rejects.toMatchObject({
      code: 'media_rejected',
    })
    expect(chunksSent).toBe(chunksUntilOverLimit)
    expect(cancelled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a streamed source exactly at the configured byte bound', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'video/mp4' } }))

    await expect(fetchVideoBytes('x', 'https://cdn.divine.video/at-limit.mp4', 4)).resolves.toMatchObject({
      bytes: expect.objectContaining({ byteLength: 4 }),
      contentType: 'video/mp4',
    })
  })

  it.each([
    ['null body', new Response(null, { headers: { 'content-type': 'video/mp4' } })],
    [
      'empty stream',
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close()
          },
        }),
        { headers: { 'content-type': 'video/mp4' } },
      ),
    ],
  ])('rejects an X source with a %s before INIT', async (_case, response) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(response)

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'media_rejected',
      platform: 'x',
      providerResponse: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'in_progress'])('returns a minimized X checkpoint when FINALIZE is %s', async (state) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', init_secret: 'init-sentinel' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({ data: { id: 'media-id', processing_info: { state, nested_secret: 'finalize-sentinel' } } }),
      )

    await expect(adapter.publishVideo(publishInput())).resolves.toEqual({
      status: 'processing',
      externalPostId: 'media-id',
      providerResponse: { mediaId: 'media-id', caption: 'caption' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('polls X STATUS on the exact v2 endpoint and posts after succeeded behind the fence', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    const events: string[] = []
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ data: { id: 'media-id', processing_info: { state: 'succeeded', status_secret: 'status-sentinel' } } }),
      )
      .mockImplementationOnce(async () => {
        events.push('tweet-fetch')
        return Response.json({ data: { id: 'tweet-id' } })
      })

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: { mediaId: 'media-id', caption: 'caption' },
        beforeExternalPost: async () => {
          events.push('fence')
        },
      }),
    ).resolves.toEqual({
      status: 'posted',
      externalPostId: 'tweet-id',
      externalPostUrl: 'https://x.com/i/web/status/tweet-id',
      providerResponse: {},
    })

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.x.com/2/media/upload?command=STATUS&media_id=media-id')
    await expect(bodyAsJson(fetchMock.mock.calls[1])).resolves.toMatchObject({
      text: 'caption',
      media: { media_ids: ['media-id'] },
    })
    expect(events).toEqual(['fence', 'tweet-fetch'])
  })

  it.each(['pending', 'in_progress'])('keeps polling when X STATUS is %s', async (state) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          id: 'media-id',
          processing_info: { state, token: 'status-processing-token-sentinel' },
        },
      }),
    )

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: { mediaId: 'media-id', caption: 'caption' },
      }),
    ).resolves.toEqual({
      status: 'processing',
      externalPostId: 'media-id',
      providerResponse: { mediaId: 'media-id', caption: 'caption' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['FINALIZE', 'failed', 'media_rejected'],
    ['FINALIZE', 'mystery', 'unknown_platform_error'],
    ['FINALIZE', '', 'unknown_platform_error'],
    ['STATUS', 'failed', 'media_rejected'],
    ['STATUS', 'mystery', 'unknown_platform_error'],
    ['STATUS', '', 'unknown_platform_error'],
  ])('fails closed for X %s processing state %j as %s', async (phase, state, code) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    const processingInfo = state === '' ? { provider_secret: `${phase}-sentinel` } : { state, provider_secret: `${phase}-sentinel` }
    if (phase === 'FINALIZE') {
      fetchMock
        .mockResolvedValueOnce(new Response(VIDEO_BYTES))
        .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(Response.json({ data: { id: 'media-id', processing_info: processingInfo } }))
      await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({ code, providerResponse: undefined })
    } else {
      fetchMock.mockResolvedValueOnce(Response.json({ data: { id: 'media-id', processing_info: processingInfo } }))
      await expect(
        adapter.pollPublishStatus?.({
          accessToken: 'access',
          providerResponse: { mediaId: 'media-id', caption: 'caption' },
          beforeExternalPost: async () => undefined,
        }),
      ).rejects.toMatchObject({ code, providerResponse: undefined })
    }
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === 'https://api.x.com/2/tweets')).toBe(false)
  })

  it.each([
    ['missing', { data: {} }],
    ['empty', { data: { id: '' } }],
    ['whitespace', { data: { id: '   ' } }],
    ['numeric', { data: { id: 123 } }],
    ['object', { data: { id: { raw: 'object-id-sentinel' } } }],
  ])('rejects %s X INIT media id before APPEND without retaining the provider body', async (_case, response) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ ...response, raw_token: 'init-media-id-sentinel' }))

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({
      code: 'unknown_platform_error',
      providerResponse: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requires the durable callback before X tweet creation and never fetches the tweet without it', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))

    await expect(adapter.publishVideo(publishInput())).rejects.toMatchObject({ code: 'unknown_platform_error' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not create an X tweet when the durable callback rejects', async () => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))

    await expect(
      adapter.publishVideo({
        ...publishInput(),
        beforeExternalPost: async () => {
          throw new Error('fence failed')
        },
      }),
    ).rejects.toThrow('fence failed')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['missing', { data: { tweet_secret: 'missing-tweet-id-sentinel' } }],
    ['empty', { data: { id: '', tweet_secret: 'empty-tweet-id-sentinel' } }],
    ['whitespace', { data: { id: '   ', tweet_secret: 'whitespace-tweet-id-sentinel' } }],
    ['numeric', { data: { id: 123, tweet_secret: 'numeric-tweet-id-sentinel' } }],
    ['object', { data: { id: { raw: 'object-tweet-id-sentinel' } } }],
  ])('rejects a 2xx X tweet response with %s id and does not report it as posted', async (_case, response) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })
    fetchMock
      .mockResolvedValueOnce(new Response(VIDEO_BYTES))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'media-id' } }))
      .mockResolvedValueOnce(Response.json(response))

    await expect(
      adapter.publishVideo({ ...publishInput(), beforeExternalPost: async () => undefined }),
    ).rejects.toMatchObject({ code: 'unknown_platform_error', providerResponse: undefined })
    expect(fetchMock.mock.calls.filter((call) => String(call[0]) === 'https://api.x.com/2/tweets')).toHaveLength(1)
  })

  it.each([
    ['whitespace', '   '],
    ['numeric', 123],
    ['object', { raw: 'checkpoint-object-id-sentinel' }],
  ])('rejects a %s X STATUS checkpoint media id before any provider request', async (_case, mediaId) => {
    const adapter = createXAdapter({ clientId: 'client', clientSecret: 'secret' })

    await expect(
      adapter.pollPublishStatus?.({
        accessToken: 'access',
        providerResponse: { mediaId, caption: 'caption' },
        beforeExternalPost: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'unknown_platform_error', providerResponse: undefined })
    expect(fetchMock).not.toHaveBeenCalled()
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
