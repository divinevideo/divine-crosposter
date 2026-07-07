import type { Env, Platform } from './types'
import { HttpError } from './utils/http'

export type AppConfig = {
  keycastUrl: string
  funnelcakeUrl: string
  oauthRedirectBase: string
  tokenEncryptionKey: string
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

export function loadConfig(env: Env): AppConfig {
  if (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.length < 32) {
    throw new HttpError(500, 'invalid_config', 'TOKEN_ENCRYPTION_KEY must be at least 32 characters')
  }

  return {
    keycastUrl: requireUrl('KEYCAST_URL', env.KEYCAST_URL),
    funnelcakeUrl: requireUrl('FUNNELCAKE_URL', env.FUNNELCAKE_URL),
    oauthRedirectBase: requireUrl('OAUTH_REDIRECT_BASE', env.OAUTH_REDIRECT_BASE),
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    features: {
      instagram: isEnabled(env.ENABLE_INSTAGRAM),
      tiktok: isEnabled(env.ENABLE_TIKTOK),
      x: isEnabled(env.ENABLE_X),
      youtube: isEnabled(env.ENABLE_YOUTUBE),
    },
  }
}
