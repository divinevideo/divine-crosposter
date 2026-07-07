import type { Env, Platform } from './types'
import { HttpError } from './utils/http'

export type YouTubePrivacyStatus = 'private' | 'public' | 'unlisted'

export const AUTO_RECONCILE_USER_BATCH_SIZE = 100
export const AUTO_RECONCILE_MAX_USERS_PER_RUN = 500
export const AUTO_RECONCILE_VIDEO_LIMIT_PER_USER = 25

export type AppConfig = {
  keycastUrl: string
  funnelcakeUrl: string
  oauthRedirectBase: string
  tokenEncryptionKey: string
  youtubeDefaultPrivacyStatus: YouTubePrivacyStatus
  features: Record<Platform, boolean>
}

function requireUrl(name: 'KEYCAST_URL' | 'FUNNELCAKE_URL' | 'OAUTH_REDIRECT_BASE', value: string): string {
  if (!value) {
    throw new HttpError(500, 'invalid_config', `${name} is required`)
  }

  try {
    const parsed = new URL(value)
    return parsed.toString().replace(/\/$/, '')
  } catch {
    throw new HttpError(500, 'invalid_config', `${name} must be a valid URL`)
  }
}

function isEnabled(value: string | undefined): boolean {
  return value === 'true'
}

function parseYouTubePrivacyStatus(value: string | undefined): YouTubePrivacyStatus {
  if (!value) {
    return 'private'
  }
  if (value === 'private' || value === 'public' || value === 'unlisted') {
    return value
  }
  throw new HttpError(500, 'invalid_config', 'YOUTUBE_DEFAULT_PRIVACY_STATUS must be private, public, or unlisted')
}

export function loadConfig(env: Env): AppConfig {
  if (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.length < 32) {
    throw new HttpError(500, 'invalid_config', 'TOKEN_ENCRYPTION_KEY must be at least 32 characters')
  }

  return {
    keycastUrl: requireUrl('KEYCAST_URL', env.KEYCAST_URL),
    funnelcakeUrl: requireUrl('FUNNELCAKE_URL', env.FUNNELCAKE_URL),
    oauthRedirectBase: requireUrl('OAUTH_REDIRECT_BASE', env.OAUTH_REDIRECT_BASE),
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    youtubeDefaultPrivacyStatus: parseYouTubePrivacyStatus(env.YOUTUBE_DEFAULT_PRIVACY_STATUS),
    features: {
      instagram: isEnabled(env.ENABLE_INSTAGRAM),
      tiktok: isEnabled(env.ENABLE_TIKTOK),
      x: isEnabled(env.ENABLE_X),
      youtube: isEnabled(env.ENABLE_YOUTUBE),
    },
  }
}
