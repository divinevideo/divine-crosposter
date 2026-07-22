import { asRecord, expectProviderOk, PlatformAdapterError } from './adapter'
import type { PlatformAccount, PlatformAdapter, PublishInput, PublishResult, TokenSet } from './adapter'

type InstagramConfig = {
  clientId: string
  clientSecret: string
}

// "Instagram API with Instagram Login": creators sign in with their Instagram
// professional account directly — no Facebook Page link required.
const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
const SHORT_LIVED_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const GRAPH_BASE = 'https://graph.instagram.com/v23.0'
const GRAPH_ROOT = 'https://graph.instagram.com'
const SCOPES = 'instagram_business_basic,instagram_business_content_publish'

// Long-lived tokens refresh with the token itself (ig_refresh_token grant), so
// the access token doubles as the stored refresh token.
function longLivedTokenSet(response: Record<string, unknown>): TokenSet {
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : undefined
  const accessToken = String(response.access_token ?? '')
  return {
    accessToken,
    refreshToken: accessToken || undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    scopes: typeof response.scope === 'string' ? response.scope.split(',').map((scope) => scope.trim()) : [],
    metadata: response,
  }
}

function instagramCreationId(providerResponse: Record<string, unknown>): string {
  const container = asRecord(providerResponse.container)
  return String(providerResponse.creationId ?? providerResponse.id ?? providerResponse.creation_id ?? container.id ?? '')
}

function instagramExternalAccountId(providerResponse: Record<string, unknown>): string {
  return String(providerResponse.externalAccountId ?? providerResponse.external_account_id ?? '')
}

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', body })
  return asRecord(await expectProviderOk('instagram', response))
}

async function getJson(url: URL): Promise<Record<string, unknown>> {
  return asRecord(await expectProviderOk('instagram', await fetch(url.toString())))
}

async function fetchContainerStatus(creationId: string, accessToken: string): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH_BASE}/${creationId}`)
  url.searchParams.set('fields', 'status_code,status')
  url.searchParams.set('access_token', accessToken)
  const status = await getJson(url)
  console.log(`instagram container ${creationId} status ${String(status.status_code ?? 'unknown')}`)
  if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
    throw new PlatformAdapterError(
      'instagram',
      'media_rejected',
      `instagram rejected the video: ${String(status.status ?? status.status_code)}`,
      undefined,
      status,
    )
  }
  return status
}

export function createInstagramAdapter(config: InstagramConfig): PlatformAdapter {
  return {
    platform: 'instagram',
    buildAuthorizationUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', SCOPES)
      return url.toString()
    },
    async exchangeCallback({ code, redirectUri }) {
      const shortLived = await postForm(
        SHORT_LIVED_TOKEN_URL,
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          code,
          grant_type: 'authorization_code',
        }),
      )

      const exchangeUrl = new URL(`${GRAPH_ROOT}/access_token`)
      exchangeUrl.searchParams.set('grant_type', 'ig_exchange_token')
      exchangeUrl.searchParams.set('client_secret', config.clientSecret)
      exchangeUrl.searchParams.set('access_token', String(shortLived.access_token ?? ''))
      const longLived = await getJson(exchangeUrl)

      const tokens = longLivedTokenSet(longLived)
      return { ...tokens, metadata: { ...longLived, user_id: shortLived.user_id, permissions: shortLived.permissions } }
    },
    async refreshToken({ refreshToken }) {
      const url = new URL(`${GRAPH_ROOT}/refresh_access_token`)
      url.searchParams.set('grant_type', 'ig_refresh_token')
      url.searchParams.set('access_token', refreshToken)
      return longLivedTokenSet(await getJson(url))
    },
    async fetchAccount({ accessToken }) {
      const url = new URL(`${GRAPH_BASE}/me`)
      url.searchParams.set('fields', 'user_id,username,name,account_type')
      url.searchParams.set('access_token', accessToken)
      const body = await getJson(url)
      const instagramAccountId = String(body.user_id ?? body.id ?? '')
      return {
        id: instagramAccountId,
        name: String(body.username ?? body.name ?? 'Instagram account'),
        metadata: body,
      } satisfies PlatformAccount
    },
    async publishVideo(input: PublishInput): Promise<PublishResult> {
      const createBody = new URLSearchParams({
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        access_token: input.accessToken,
      })
      const container = await postForm(`${GRAPH_BASE}/${input.externalAccountId}/media`, createBody)
      const creationId = String(container.id ?? '')
      const status = await fetchContainerStatus(creationId, input.accessToken)

      if (status.status_code !== 'FINISHED') {
        return {
          status: 'processing',
          externalPostId: creationId,
          providerResponse: {
            id: creationId,
            creationId,
            externalAccountId: input.externalAccountId,
            container,
            status,
          },
        }
      }

      const published = await postForm(
        `${GRAPH_BASE}/${input.externalAccountId}/media_publish`,
        new URLSearchParams({ creation_id: creationId, access_token: input.accessToken }),
      )
      const externalPostId = String(published.id ?? creationId)
      return {
        status: 'posted',
        externalPostId,
        externalPostUrl: typeof published.permalink === 'string' ? published.permalink : undefined,
        providerResponse: {
          id: creationId,
          creationId,
          externalAccountId: input.externalAccountId,
          container,
          status,
          published,
        },
      }
    },
    async pollPublishStatus({ accessToken, providerResponse }) {
      const creationId = instagramCreationId(providerResponse)
      const status = await fetchContainerStatus(creationId, accessToken)
      if (status.status_code !== 'FINISHED') {
        return {
          status: 'processing',
          externalPostId: creationId,
          providerResponse: { ...providerResponse, id: creationId, creationId, status },
        }
      }

      const externalAccountId = instagramExternalAccountId(providerResponse)
      const published = await postForm(
        `${GRAPH_BASE}/${externalAccountId}/media_publish`,
        new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
      )
      const externalPostId = String(published.id ?? creationId)
      return {
        status: 'posted',
        externalPostId,
        externalPostUrl: typeof published.permalink === 'string' ? published.permalink : undefined,
        providerResponse: { ...providerResponse, id: creationId, creationId, status, published },
      }
    },
  }
}
