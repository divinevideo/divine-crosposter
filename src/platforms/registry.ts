import type { Env, Platform } from '../types'
import { loadConfig, parseYouTubePrivacyStatus } from '../config'
import type { YouTubePrivacyStatus } from '../config'
import type { PlatformAdapter } from './adapter'
import { createInstagramAdapter } from './instagram'
import { createTikTokAdapter } from './tiktok'
import { createXAdapter } from './x'
import { createYouTubeAdapter } from './youtube'

export type ProviderSummary = {
  platform: Platform
  enabled: boolean
  supportsAutomatic: boolean
}

const PLATFORM_ORDER: readonly Platform[] = ['instagram', 'tiktok', 'x', 'youtube']

function enabled(value: string | undefined): boolean {
  return value === 'true'
}

function hasInstagram(env: Env): boolean {
  return enabled(env.ENABLE_INSTAGRAM) && Boolean(env.INSTAGRAM_CLIENT_ID && env.INSTAGRAM_CLIENT_SECRET)
}

function hasTikTok(env: Env): boolean {
  return enabled(env.ENABLE_TIKTOK) && Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET)
}

function hasX(env: Env): boolean {
  return enabled(env.ENABLE_X) && Boolean(env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET)
}

function hasYouTube(env: Env): boolean {
  return enabled(env.ENABLE_YOUTUBE) && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

function isConfigured(env: Env, platform: Platform): boolean {
  switch (platform) {
    case 'instagram':
      return hasInstagram(env)
    case 'tiktok':
      return hasTikTok(env)
    case 'x':
      return hasX(env)
    case 'youtube':
      return hasYouTube(env)
  }
}

export function getEnabledAdapters(env: Env): PlatformAdapter[] {
  const config = loadConfig(env)
  return PLATFORM_ORDER.flatMap((platform) => {
    const adapter = configuredAdapter(env, platform, config.youtubeDefaultPrivacyStatus)
    return adapter ? [adapter] : []
  })
}

export function getProviderSummaries(env: Env): ProviderSummary[] {
  return PLATFORM_ORDER.map((platform) => ({
    platform,
    enabled: isConfigured(env, platform),
    supportsAutomatic: true,
  }))
}

export function getAdapter(env: Env, platform: Platform): PlatformAdapter | null {
  return configuredAdapter(env, platform)
}

function configuredAdapter(
  env: Env,
  platform: Platform,
  youtubePrivacyStatus?: YouTubePrivacyStatus,
): PlatformAdapter | null {
  switch (platform) {
    case 'instagram': {
      const { INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET } = env
      return hasInstagram(env) && INSTAGRAM_CLIENT_ID && INSTAGRAM_CLIENT_SECRET
        ? createInstagramAdapter({ clientId: INSTAGRAM_CLIENT_ID, clientSecret: INSTAGRAM_CLIENT_SECRET })
        : null
    }
    case 'tiktok': {
      const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET } = env
      return hasTikTok(env) && TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET
        ? createTikTokAdapter({ clientKey: TIKTOK_CLIENT_KEY, clientSecret: TIKTOK_CLIENT_SECRET })
        : null
    }
    case 'x': {
      const { TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET } = env
      return hasX(env) && TWITTER_CLIENT_ID && TWITTER_CLIENT_SECRET
        ? createXAdapter({ clientId: TWITTER_CLIENT_ID, clientSecret: TWITTER_CLIENT_SECRET })
        : null
    }
    case 'youtube': {
      const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env
      return hasYouTube(env) && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
        ? createYouTubeAdapter({
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            defaultPrivacyStatus: youtubePrivacyStatus ?? parseYouTubePrivacyStatus(env.YOUTUBE_DEFAULT_PRIVACY_STATUS),
          })
        : null
    }
  }
}
