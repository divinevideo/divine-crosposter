import { asRecord, expectProviderOk, fetchVideoBytes, PlatformAdapterError } from './adapter'
import type { PlatformAdapter, PublishResult, TokenSet } from './adapter'

type XConfig = {
  clientId: string
  clientSecret: string
}

const API_BASE = 'https://api.x.com/2'
const UPLOAD_BASE = 'https://api.x.com/2/media/upload'
const SCOPES = 'tweet.read tweet.write users.read media.write offline.access'

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.slice(index, index + 0x8000))
  }
  return btoa(binary)
}

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

function processingInfoFromResponse(response: Record<string, unknown>): Record<string, unknown> {
  const data = xData(response)
  return asRecord(data.processing_info ?? response.processing_info)
}

function processingState(response: Record<string, unknown>): string {
  return String(processingInfoFromResponse(response).state ?? '')
}

async function createPost(accessToken: string, mediaId: string, caption: string): Promise<Record<string, unknown>> {
  return asRecord(
    await expectProviderOk(
      'x',
      await fetch(`${API_BASE}/tweets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: caption, media: { media_ids: [mediaId] } }),
      }),
    ),
  )
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
    async publishVideo({ accessToken, videoUrl, caption }): Promise<PublishResult> {
      const video = await fetchVideoBytes('x', videoUrl)
      const init = asRecord(
        await expectProviderOk(
          'x',
          await fetch(UPLOAD_BASE, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: new URLSearchParams({
              command: 'INIT',
              total_bytes: String(video.bytes.byteLength),
              media_type: video.contentType,
              media_category: 'tweet_video',
            }),
          }),
        ),
      )
      const mediaId = mediaIdFromResponse(init)
      await expectProviderOk(
        'x',
        await fetch(`${UPLOAD_BASE}/${mediaId}/append`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            media: bytesToBase64(video.bytes),
            segment_index: 0,
          }),
        }),
      )
      const finalize = asRecord(
        await expectProviderOk(
          'x',
          await fetch(`${UPLOAD_BASE}/${mediaId}/finalize`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        ),
      )
      if (processingState(finalize)) {
        return {
          status: 'processing',
          externalPostId: mediaId,
          providerResponse: { init, finalize, mediaId, caption },
        }
      }

      const tweet = await createPost(accessToken, mediaId, caption)
      const data = asRecord(tweet.data)
      return { status: 'posted', externalPostId: String(data.id ?? ''), providerResponse: { init, finalize, tweet } }
    },
    async pollPublishStatus({ accessToken, providerResponse }) {
      const mediaId = String(providerResponse.mediaId ?? mediaIdFromResponse(providerResponse))
      const caption = String(providerResponse.caption ?? '')
      const url = new URL(UPLOAD_BASE)
      url.searchParams.set('command', 'STATUS')
      url.searchParams.set('media_id', mediaId)
      const statusResponse = asRecord(
        await expectProviderOk('x', await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } })),
      )
      const state = processingState(statusResponse)
      if (state && state !== 'succeeded') {
        return {
          status: 'processing',
          externalPostId: mediaId,
          providerResponse: { ...providerResponse, status: statusResponse, mediaId, caption },
        }
      }

      const tweet = await createPost(accessToken, mediaId, caption)
      const data = asRecord(tweet.data)
      return {
        status: 'posted',
        externalPostId: String(data.id ?? ''),
        providerResponse: { ...providerResponse, status: statusResponse, tweet, mediaId },
      }
    },
  }
}
