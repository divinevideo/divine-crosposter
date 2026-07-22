import { asRecord, expectProviderOk, fetchVideoBytes, PlatformAdapterError } from './adapter'
import type { PlatformAdapter, PublishResult, TokenSet } from './adapter'

type XConfig = {
  clientId: string
  clientSecret: string
}

const API_BASE = 'https://api.x.com/2'
const UPLOAD_BASE = 'https://api.x.com/2/media/upload'
const SCOPES = 'tweet.read tweet.write users.read media.write offline.access'

export const X_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024

function tokenSetFromResponse(response: Record<string, unknown>): TokenSet {
  if (typeof response.access_token !== 'string' || response.access_token.length === 0) {
    throw new PlatformAdapterError('x', 'unknown_platform_error', 'X token response missing access token', 200)
  }
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : undefined
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    scopes: typeof response.scope === 'string' ? response.scope.split(' ') : SCOPES.split(' '),
    metadata: response,
  }
}

async function requestToken(config: XConfig, body: URLSearchParams): Promise<TokenSet> {
  const response = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  return tokenSetFromResponse(asRecord(await expectProviderOk('x', response)))
}

function xData(response: Record<string, unknown>): Record<string, unknown> {
  return asRecord(response.data)
}

function mediaIdFromResponse(response: Record<string, unknown>): string {
  const data = xData(response)
  return String(data.id ?? response.media_id_string ?? response.media_id ?? '')
}

function processingInfoFromResponse(response: Record<string, unknown>): Record<string, unknown> | null {
  const data = xData(response)
  if (Object.prototype.hasOwnProperty.call(data, 'processing_info')) {
    return asRecord(data.processing_info)
  }
  if (Object.prototype.hasOwnProperty.call(response, 'processing_info')) {
    return asRecord(response.processing_info)
  }
  return null
}

function isMediaReady(response: Record<string, unknown>): boolean {
  const processingInfo = processingInfoFromResponse(response)
  if (processingInfo === null) return true

  const state = typeof processingInfo.state === 'string' ? processingInfo.state : ''
  if (state === 'succeeded') return true
  if (state === 'pending' || state === 'in_progress') return false
  if (state === 'failed') {
    throw new PlatformAdapterError('x', 'media_rejected', 'X rejected the uploaded media')
  }
  throw new PlatformAdapterError('x', 'unknown_platform_error', 'X returned an unknown media processing state')
}

function mediaForm(fields: Record<string, string>, media?: Blob): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value)
  }
  if (media) {
    form.set('media', media, 'video-chunk')
  }
  return form
}

async function postMediaForm(accessToken: string, form: FormData): Promise<Record<string, unknown>> {
  return asRecord(
    await expectProviderOk(
      'x',
      await fetch(UPLOAD_BASE, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
        body: form,
      }),
    ),
  )
}

async function createPost(
  accessToken: string,
  mediaId: string,
  caption: string,
  beforeExternalPost?: () => Promise<void>,
): Promise<PublishResult> {
  if (!beforeExternalPost) {
    throw new PlatformAdapterError('x', 'unknown_platform_error', 'X post dispatch fence is required')
  }
  await beforeExternalPost()
  const tweet = asRecord(
    await expectProviderOk(
      'x',
      await fetch(`${API_BASE}/tweets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: caption, media: { media_ids: [mediaId] } }),
      }),
    ),
  )
  const id = String(asRecord(tweet.data).id ?? '').trim()
  if (!id) {
    throw new PlatformAdapterError('x', 'unknown_platform_error', 'X tweet response missing post id', 200)
  }
  return {
    status: 'posted',
    externalPostId: id,
    externalPostUrl: `https://x.com/i/web/status/${id}`,
    providerResponse: {},
  }
}

export function createXAdapter(config: XConfig): PlatformAdapter {
  return {
    platform: 'x',
    buildAuthorizationUrl({ state, redirectUri, codeChallenge }) {
      const url = new URL('https://x.com/i/oauth2/authorize')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', SCOPES)
      if (codeChallenge) {
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('code_challenge_method', 'S256')
      }
      return url.toString()
    },
    async exchangeCallback({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        code,
      })
      if (codeVerifier) body.set('code_verifier', codeVerifier)
      return requestToken(config, body)
    },
    async refreshToken({ refreshToken }) {
      return requestToken(
        config,
        new URLSearchParams({ client_id: config.clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
      )
    },
    async fetchAccount({ accessToken }) {
      const response = await fetch(`${API_BASE}/users/me`, { headers: { authorization: `Bearer ${accessToken}` } })
      const body = asRecord(await expectProviderOk('x', response))
      const data = asRecord(body.data)
      return { id: String(data.id ?? ''), name: String(data.username ?? data.name ?? 'X account'), metadata: body }
    },
    async publishVideo({ accessToken, videoUrl, caption, beforeExternalPost }): Promise<PublishResult> {
      const video = await fetchVideoBytes('x', videoUrl)
      const init = await postMediaForm(
        accessToken,
        mediaForm({
          command: 'INIT',
          total_bytes: String(video.bytes.byteLength),
          media_type: video.contentType,
          media_category: 'tweet_video',
        }),
      )
      const mediaId = mediaIdFromResponse(init).trim()
      if (!mediaId) {
        throw new PlatformAdapterError('x', 'unknown_platform_error', 'X INIT response missing media id', 200)
      }

      let segmentIndex = 0
      for (let offset = 0; offset < video.bytes.byteLength; offset += X_UPLOAD_CHUNK_BYTES) {
        const chunk = video.bytes.slice(offset, Math.min(offset + X_UPLOAD_CHUNK_BYTES, video.bytes.byteLength))
        await postMediaForm(
          accessToken,
          mediaForm(
            { command: 'APPEND', media_id: mediaId, segment_index: String(segmentIndex) },
            new Blob([chunk], { type: video.contentType }),
          ),
        )
        segmentIndex += 1
      }

      const finalize = await postMediaForm(
        accessToken,
        mediaForm({ command: 'FINALIZE', media_id: mediaId }),
      )
      if (!isMediaReady(finalize)) {
        return {
          status: 'processing',
          externalPostId: mediaId,
          providerResponse: { mediaId, caption },
        }
      }

      return createPost(accessToken, mediaId, caption, beforeExternalPost)
    },
    async pollPublishStatus({ accessToken, providerResponse, beforeExternalPost }) {
      const mediaId = String(providerResponse.mediaId ?? mediaIdFromResponse(providerResponse)).trim()
      const caption = String(providerResponse.caption ?? '')
      if (!mediaId) {
        throw new PlatformAdapterError('x', 'unknown_platform_error', 'X processing checkpoint missing media id')
      }
      const url = new URL(UPLOAD_BASE)
      url.searchParams.set('command', 'STATUS')
      url.searchParams.set('media_id', mediaId)
      const statusResponse = asRecord(
        await expectProviderOk('x', await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } })),
      )
      if (!isMediaReady(statusResponse)) {
        return {
          status: 'processing',
          externalPostId: mediaId,
          providerResponse: { mediaId, caption },
        }
      }

      return createPost(accessToken, mediaId, caption, beforeExternalPost)
    },
  }
}
