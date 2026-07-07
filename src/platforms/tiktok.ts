import { PlatformAdapterError, asRecord, expectProviderOk } from './adapter'
import type { PlatformAdapter, PublishResult, TokenSet } from './adapter'

type TikTokConfig = {
  clientKey: string
  clientSecret: string
}

const API_BASE = 'https://open.tiktokapis.com/v2'

function tokenSetFromResponse(response: Record<string, unknown>): TokenSet {
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : undefined
  return {
    accessToken: String(response.access_token ?? ''),
    refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    scopes: typeof response.scope === 'string' ? response.scope.split(',').map((scope) => scope.trim()) : [],
    metadata: response,
  }
}

function creatorInfoFromResponse(response: Record<string, unknown>): Record<string, unknown> {
  return asRecord(response.data)
}

function privacyLevelForV1(creatorInfo: Record<string, unknown>): string {
  if (
    creatorInfo.direct_post_available === false ||
    creatorInfo.direct_post_enabled === false ||
    creatorInfo.can_post === false
  ) {
    throw new PlatformAdapterError('tiktok', 'platform_review_required', 'TikTok direct post is not available')
  }

  const options = creatorInfo.privacy_level_options
  if (Array.isArray(options) && options.length > 0 && !options.includes('SELF_ONLY')) {
    throw new PlatformAdapterError('tiktok', 'platform_review_required', 'TikTok private posting is not available')
  }

  return 'SELF_ONLY'
}

function tiktokData(response: Record<string, unknown>): Record<string, unknown> {
  return asRecord(response.data)
}

function tiktokPublishId(response: Record<string, unknown>): string {
  const data = tiktokData(response)
  return String(data.publish_id ?? response.publish_id ?? '')
}

function tiktokStatus(response: Record<string, unknown>): string {
  const data = tiktokData(response)
  return String(data.status ?? response.status ?? '')
}

function publishIdFromProviderResponse(providerResponse: Record<string, unknown>): string {
  return String(providerResponse.publish_id ?? tiktokData(providerResponse).publish_id ?? providerResponse.externalPostId ?? '')
}

export function createTikTokAdapter(config: TikTokConfig): PlatformAdapter {
  return {
    platform: 'tiktok',
    buildAuthorizationUrl({ state, redirectUri, codeChallenge }) {
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
      url.searchParams.set('client_key', config.clientKey)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'user.info.basic,video.publish')
      if (codeChallenge) {
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('code_challenge_method', 'S256')
      }
      return url.toString()
    },
    async exchangeCallback({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      })
      if (codeVerifier) body.set('code_verifier', codeVerifier)
      const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body })
      return tokenSetFromResponse(asRecord(await expectProviderOk('tiktok', response)))
    },
    async refreshToken({ refreshToken }) {
      const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
      const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body })
      return tokenSetFromResponse(asRecord(await expectProviderOk('tiktok', response)))
    },
    async fetchAccount({ accessToken }) {
      const response = await fetch(`${API_BASE}/user/info/?fields=open_id,display_name,avatar_url`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      const body = asRecord(await expectProviderOk('tiktok', response))
      const user = asRecord(asRecord(body.data).user)
      return {
        id: String(user.open_id ?? ''),
        name: String(user.display_name ?? 'TikTok account'),
        metadata: body,
      }
    },
    async publishVideo({ accessToken, videoUrl, caption }): Promise<PublishResult> {
      const creatorInfoResponse = await fetch(`${API_BASE}/post/publish/creator_info/query/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      })
      const creatorInfo = creatorInfoFromResponse(asRecord(await expectProviderOk('tiktok', creatorInfoResponse)))
      const privacyLevel = privacyLevelForV1(creatorInfo)

      const response = await fetch(`${API_BASE}/post/publish/video/init/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          post_info: {
            title: caption,
            privacy_level: privacyLevel,
            disable_duet: false,
            disable_comment: false,
            brand_content_toggle: false,
            brand_organic_toggle: false,
          },
          source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
        }),
      })
      const body = asRecord(await expectProviderOk('tiktok', response))
      const publishId = tiktokPublishId(body)
      return {
        status: 'processing',
        externalPostId: publishId,
        providerResponse: { creatorInfo, ...body, publish_id: publishId },
      }
    },
    async pollPublishStatus({ accessToken, providerResponse }) {
      const publishId = publishIdFromProviderResponse(providerResponse)
      const response = await fetch(`${API_BASE}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
      })
      const body = asRecord(await expectProviderOk('tiktok', response))
      const status = tiktokStatus(body) === 'PUBLISH_COMPLETE' ? 'posted' : 'processing'
      return { status, externalPostId: publishId, providerResponse: { ...body, publish_id: publishId } }
    },
  }
}
