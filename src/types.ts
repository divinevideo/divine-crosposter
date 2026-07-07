export type Platform = 'instagram' | 'tiktok' | 'x' | 'youtube'
export type PreferenceMode = 'manual' | 'automatic' | 'disabled'
export type JobStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'posted'
  | 'failed'
  | 'needs_reauth'
  | 'skipped'

export type ErrorCode =
  | 'rate_limited'
  | 'needs_reauth'
  | 'media_rejected'
  | 'platform_review_required'
  | 'processing_timeout'
  | 'expired'
  | 'not_connected'
  | 'not_owner'
  | 'not_eligible'
  | 'unknown_platform_error'

export type Env = {
  DB: D1Database
  CROSSPOST_QUEUE: Queue<{ jobId: string }>
  KEYCAST_URL: string
  FUNNELCAKE_URL: string
  OAUTH_REDIRECT_BASE: string
  TOKEN_ENCRYPTION_KEY: string
  INSTAGRAM_CLIENT_ID?: string
  INSTAGRAM_CLIENT_SECRET?: string
  TWITTER_CLIENT_ID?: string
  TWITTER_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  TIKTOK_CLIENT_KEY?: string
  TIKTOK_CLIENT_SECRET?: string
  ENABLE_INSTAGRAM?: string
  ENABLE_TIKTOK?: string
  ENABLE_X?: string
  ENABLE_YOUTUBE?: string
  YOUTUBE_DEFAULT_PRIVACY_STATUS?: string
}

export type OAuthStateRecord = {
  stateId: string
  pubkey: string
  platform: Platform
  codeVerifier: string | null
  returnUrl: string
  createdAt: number
  expiresAt: number
  metadataJson: string
}

export type ConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected'

export type ConnectionRecord = {
  id: string
  pubkey: string
  platform: Platform
  externalAccountId: string
  externalAccountName: string
  encryptedAccessToken: string
  encryptedRefreshToken: string | null
  tokenExpiresAt: number | null
  grantedScopes: string
  status: ConnectionStatus
  createdAt: number
  updatedAt: number
  lastRefreshAt: number | null
  metadataJson: string
}

export type PreferenceRecord = {
  pubkey: string
  platform: Platform
  connectionId: string | null
  mode: PreferenceMode
  automaticEnabledAt: number | null
  createdAt: number
  updatedAt: number
}

export type AutoCursorRecord = {
  pubkey: string
  cursor: string | null
  lastCheckedAt: number
  updatedAt: number
}

export type JobRecord = {
  id: string
  pubkey: string
  videoEventId: string
  platform: Platform
  connectionId: string
  externalAccountId: string
  sourceMediaUrl: string
  sourceMediaHash: string
  caption: string
  status: JobStatus
  errorCode: ErrorCode | null
  errorMessage: string | null
  externalPostId: string | null
  externalPostUrl: string | null
  retryCount: number
  nextRetryAt: number | null
  expiresAt: number
  createdAt: number
  updatedAt: number
}

export type CreateJobInput = Omit<JobRecord, 'errorCode' | 'errorMessage' | 'externalPostId' | 'externalPostUrl' | 'retryCount' | 'nextRetryAt'> & {
  errorCode?: ErrorCode | null
  errorMessage?: string | null
  externalPostId?: string | null
  externalPostUrl?: string | null
  retryCount?: number
  nextRetryAt?: number | null
}

export type UpdateJobStatusInput = {
  id: string
  status: JobStatus
  updatedAt: number
  errorCode?: ErrorCode | null
  errorMessage?: string | null
  externalPostId?: string | null
  externalPostUrl?: string | null
  retryCount?: number
  nextRetryAt?: number | null
}

export type JobAttemptRecord = {
  id: string
  jobId: string
  status: JobStatus
  errorCode: ErrorCode | null
  errorMessage: string | null
  providerStatus: number | null
  providerResponseJson: string | null
  createdAt: number
}
