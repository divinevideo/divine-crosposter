import { asRecord, expectProviderOk, fetchVideoBytes } from './adapter'
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
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : undefined
  return {
    accessToken: String(response.access_token ?? ''),
    refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    scopes: typeof response.scope === 'string' ? response.scope.split(' ') : SCOPES.split(' '),
    metadata: response,
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
      const response = await fetch(`${API_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}` },
        body,
      })
      return tokenSetFromResponse(asRecord(await expectProviderOk('x', response)))
    },
    async refreshToken({ refreshToken }) {
      const response = await fetch(`${API_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}` },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      })
      return tokenSetFromResponse(asRecord(await expectProviderOk('x', response)))
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
      const mediaId = String(init.media_id_string ?? init.media_id ?? '')
      await expectProviderOk(
        'x',
        await fetch(UPLOAD_BASE, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}` },
          body: new URLSearchParams({
            command: 'APPEND',
            media_id: mediaId,
            segment_index: '0',
            media_data: bytesToBase64(video.bytes),
          }),
        }),
      )
      const finalize = asRecord(
        await expectProviderOk(
          'x',
          await fetch(UPLOAD_BASE, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }),
          }),
        ),
      )
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
      const data = asRecord(tweet.data)
      return { status: 'posted', externalPostId: String(data.id ?? ''), providerResponse: { init, finalize, tweet } }
    },
  }
}
