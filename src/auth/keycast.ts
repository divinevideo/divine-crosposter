import type { Env } from '../types'
import { loadConfig } from '../config'
import { HttpError } from '../utils/http'
import { normalizePubkey } from '../utils/validation'

type KeycastPublicKeyResponse = {
  result?: unknown
  error?: unknown
}

function parseBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match || !match[1].trim()) {
    throw new HttpError(401, 'unauthorized', 'missing bearer token')
  }
  return match[1].trim()
}

function upstreamAuthError(status: number): HttpError {
  if (status === 401) {
    return new HttpError(401, 'unauthorized', 'invalid bearer token')
  }
  if (status === 403) {
    return new HttpError(403, 'forbidden', 'bearer token is not allowed')
  }
  return new HttpError(502, 'keycast_unavailable', 'keycast auth failed')
}

export async function authenticateRequest(request: Request, env: Env): Promise<{ pubkey: string; token: string }> {
  const token = parseBearerToken(request)
  const config = loadConfig(env)

  let response: Response
  try {
    response = await fetch(`${config.keycastUrl}/api/nostr`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method: 'get_public_key', params: [] }),
    })
  } catch {
    throw new HttpError(502, 'keycast_unavailable', 'keycast auth failed')
  }

  if (!response.ok) {
    throw upstreamAuthError(response.status)
  }

  let body: KeycastPublicKeyResponse
  try {
    body = (await response.json()) as KeycastPublicKeyResponse
  } catch {
    throw new HttpError(502, 'keycast_malformed_response', 'keycast response was malformed')
  }

  if (body.error || typeof body.result !== 'string' || body.result.length === 0) {
    throw new HttpError(502, 'keycast_malformed_response', 'keycast response was malformed')
  }

  try {
    return { pubkey: normalizePubkey(body.result), token }
  } catch {
    throw new HttpError(502, 'keycast_malformed_response', 'keycast response was malformed')
  }
}
