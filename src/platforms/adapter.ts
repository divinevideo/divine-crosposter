import type { ErrorCode, Platform } from '../types'

export type PlatformAccount = {
  id: string
  name: string
  metadata: Record<string, unknown>
}

export type TokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes: string[]
  metadata: Record<string, unknown>
}

export type PublishInput = {
  accessToken: string
  videoUrl: string
  mediaHash: string
  caption: string
  externalAccountId: string
}

export type PublishResult = {
  status: 'posted' | 'processing'
  externalPostId?: string
  externalPostUrl?: string
  providerResponse: Record<string, unknown>
}

export interface PlatformAdapter {
  platform: Platform
  buildAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string
  exchangeCallback(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>
  refreshToken(input: { refreshToken: string }): Promise<TokenSet>
  fetchAccount(input: { accessToken: string }): Promise<PlatformAccount>
  publishVideo(input: PublishInput): Promise<PublishResult>
  pollPublishStatus?(input: { accessToken: string; providerResponse: Record<string, unknown> }): Promise<PublishResult>
  revoke?(input: { accessToken: string; refreshToken?: string }): Promise<void>
}

export class PlatformAdapterError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly code: ErrorCode,
    message: string,
    public readonly providerStatus?: number,
    public readonly providerResponse?: unknown,
  ) {
    super(message)
  }
}

function includesMediaRejection(value: unknown): boolean {
  const normalized = JSON.stringify(value).toLowerCase()
  return (
    normalized.includes('media_rejected') ||
    normalized.includes('media rejected') ||
    normalized.includes('invalid_media') ||
    normalized.includes('unsupported media') ||
    normalized.includes('video is invalid')
  )
}

export async function readProviderResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export async function normalizeProviderError(platform: Platform, response: Response): Promise<PlatformAdapterError> {
  const providerResponse = await readProviderResponse(response)
  let code: ErrorCode = 'unknown_platform_error'

  if (response.status === 401 || response.status === 403) {
    code = 'needs_reauth'
  } else if (response.status === 429) {
    code = 'rate_limited'
  } else if (includesMediaRejection(providerResponse)) {
    code = 'media_rejected'
  }

  return new PlatformAdapterError(platform, code, `${platform} provider request failed`, response.status, providerResponse)
}

export async function expectProviderOk(platform: Platform, response: Response): Promise<unknown> {
  if (!response.ok) {
    throw await normalizeProviderError(platform, response)
  }
  return readProviderResponse(response)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
