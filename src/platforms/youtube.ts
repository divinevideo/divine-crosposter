import { PlatformAdapterError, asRecord, expectProviderOk, fetchVideoBytes } from './adapter'
import type { PlatformAdapter, PublishResult, TokenSet } from './adapter'
import type { YouTubePrivacyStatus } from '../config'

type YouTubeConfig = {
  clientId: string
  clientSecret: string
  defaultPrivacyStatus?: YouTubePrivacyStatus
}

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload']

function tokenSetFromResponse(response: Record<string, unknown>): TokenSet {
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : undefined
  return {
    accessToken: String(response.access_token ?? ''),
    refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    scopes: typeof response.scope === 'string' ? response.scope.split(' ') : SCOPES,
    metadata: response,
  }
}

export function createYouTubeAdapter(config: YouTubeConfig): PlatformAdapter {
  const defaultPrivacyStatus = config.defaultPrivacyStatus ?? 'private'

  return {
    platform: 'youtube',
    buildAuthorizationUrl({ state, redirectUri, codeChallenge }) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('scope', SCOPES.join(' '))
      if (codeChallenge) {
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('code_challenge_method', 'S256')
      }
      return url.toString()
    },
    async exchangeCallback({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      })
      if (codeVerifier) body.set('code_verifier', codeVerifier)
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
      return tokenSetFromResponse(asRecord(await expectProviderOk('youtube', response)))
    },
    async refreshToken({ refreshToken }) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      })
      return tokenSetFromResponse(asRecord(await expectProviderOk('youtube', response)))
    },
    async fetchAccount({ accessToken }) {
      const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      const body = asRecord(await expectProviderOk('youtube', response))
      const items = Array.isArray(body.items) ? body.items : []
      const channel = asRecord(items[0])
      const snippet = asRecord(channel.snippet)
      return { id: String(channel.id ?? ''), name: String(snippet.title ?? 'YouTube channel'), metadata: body }
    },
    async publishVideo({ accessToken, videoUrl, caption }): Promise<PublishResult> {
      const video = await fetchVideoBytes('youtube', videoUrl)
      const metadataResponse = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'x-upload-content-type': video.contentType,
            'x-upload-content-length': String(video.bytes.byteLength),
          },
          body: JSON.stringify({
            snippet: { title: caption.slice(0, 100) || 'Divine video', description: caption },
            status: { privacyStatus: defaultPrivacyStatus, selfDeclaredMadeForKids: false },
          }),
        },
      )
      await expectProviderOk('youtube', metadataResponse)
      const uploadUrl = metadataResponse.headers.get('location')
      if (!uploadUrl) {
        throw new PlatformAdapterError('youtube', 'unknown_platform_error', 'missing YouTube upload session')
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': video.contentType,
          'content-length': String(video.bytes.byteLength),
        },
        body: video.bytes,
      })
      const body = asRecord(await expectProviderOk('youtube', uploadResponse))
      return { status: 'posted', externalPostId: String(body.id ?? ''), providerResponse: body }
    },
  }
}
