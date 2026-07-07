import type { Platform, PreferenceMode } from '../types'
import { HttpError } from './http'

const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/
const PLATFORMS: readonly Platform[] = ['instagram', 'tiktok', 'x', 'youtube']
const PREFERENCE_MODES: readonly PreferenceMode[] = ['manual', 'automatic', 'disabled']

export function isValidHexPubkey(value: string): boolean {
  return HEX_64_PATTERN.test(value)
}

export function normalizePubkey(value: string): string {
  if (!isValidHexPubkey(value)) {
    throw new HttpError(400, 'invalid_pubkey', 'invalid pubkey')
  }
  return value.toLowerCase()
}

export function isValidEventId(value: string): boolean {
  return HEX_64_PATTERN.test(value)
}

export function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform
  }
  throw new HttpError(400, 'invalid_platform', 'invalid platform')
}

export function parsePreferenceMode(value: string): PreferenceMode {
  if ((PREFERENCE_MODES as readonly string[]).includes(value)) {
    return value as PreferenceMode
  }
  throw new HttpError(400, 'invalid_preference_mode', 'invalid preference mode')
}

export function assertAllowedReturnUrl(url: string, oauthRedirectBase: string): string {
  let parsed: URL
  let redirectBase: URL
  try {
    parsed = new URL(url)
    redirectBase = new URL(oauthRedirectBase)
  } catch {
    throw new HttpError(400, 'invalid_return_url', 'invalid return url')
  }

  const isDivineOrigin =
    parsed.protocol === 'https:' && (parsed.hostname === 'divine.video' || parsed.hostname === 'www.divine.video')
  const isRedirectBaseOrigin = parsed.origin === redirectBase.origin
  const isLocalOrigin = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'

  if (!isDivineOrigin && !isRedirectBaseOrigin && !isLocalOrigin) {
    throw new HttpError(400, 'invalid_return_url', 'invalid return url')
  }

  return url
}
