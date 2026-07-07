import { asRecord, expectProviderOk } from './adapter'
import type { PlatformAccount, PlatformAdapter, PublishInput, PublishResult, TokenSet } from './adapter'

type InstagramConfig = {
  clientId: string
  clientSecret: string
}

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

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

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', body })
  return asRecord(await expectProviderOk('instagram', response))
}

export function createInstagramAdapter(config: InstagramConfig): PlatformAdapter {
  return {
    platform: 'instagram',
    buildAuthorizationUrl({ state, redirectUri }) {
      const url = new URL('https://www.facebook.com/v20.0/dialog/oauth')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement')
      return url.toString()
    },
    async exchangeCallback({ code, redirectUri }) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
      })
      return tokenSetFromResponse(await postForm(`${GRAPH_BASE}/oauth/access_token`, body))
    },
    async refreshToken({ refreshToken }) {
      const url = new URL(`${GRAPH_BASE}/refresh_access_token`)
      url.searchParams.set('grant_type', 'ig_refresh_token')
      url.searchParams.set('access_token', refreshToken)
      const response = await fetch(url.toString())
      return tokenSetFromResponse(asRecord(await expectProviderOk('instagram', response)))
    },
    async fetchAccount({ accessToken }) {
      const url = new URL(`${GRAPH_BASE}/me/accounts`)
      url.searchParams.set('access_token', accessToken)
      const body = asRecord(await expectProviderOk('instagram', await fetch(url.toString())))
      const accounts = Array.isArray(body.data) ? body.data : []
      const account = asRecord(accounts[0])
      return {
        id: String(account.id ?? ''),
        name: String(account.name ?? account.username ?? 'Instagram account'),
        metadata: body,
      }
    },
    async publishVideo(input: PublishInput): Promise<PublishResult> {
      const createBody = new URLSearchParams({
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        access_token: input.accessToken,
      })
      const container = asRecord(
        await expectProviderOk(
          'instagram',
          await fetch(`${GRAPH_BASE}/${input.externalAccountId}/media`, { method: 'POST', body: createBody }),
        ),
      )
      const creationId = String(container.id ?? '')
      const statusUrl = new URL(`${GRAPH_BASE}/${creationId}`)
      statusUrl.searchParams.set('fields', 'status_code')
      statusUrl.searchParams.set('access_token', input.accessToken)
      const status = asRecord(await expectProviderOk('instagram', await fetch(statusUrl.toString())))

      if (status.status_code !== 'FINISHED') {
        return {
          status: 'processing',
          externalPostId: creationId,
          providerResponse: { container, status },
        }
      }

      const publishBody = new URLSearchParams({ creation_id: creationId, access_token: input.accessToken })
      const published = asRecord(
        await expectProviderOk(
          'instagram',
          await fetch(`${GRAPH_BASE}/${input.externalAccountId}/media_publish`, { method: 'POST', body: publishBody }),
        ),
      )
      const externalPostId = String(published.id ?? creationId)
      return { status: 'posted', externalPostId, providerResponse: { container, published } }
    },
    async pollPublishStatus({ accessToken, providerResponse }) {
      const creationId = String(providerResponse.id ?? providerResponse.creation_id ?? '')
      const url = new URL(`${GRAPH_BASE}/${creationId}`)
      url.searchParams.set('fields', 'status_code')
      url.searchParams.set('access_token', accessToken)
      const body = asRecord(await expectProviderOk('instagram', await fetch(url.toString())))
      return { status: body.status_code === 'FINISHED' ? 'posted' : 'processing', providerResponse: body }
    },
  }
}
