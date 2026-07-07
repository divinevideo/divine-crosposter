import { loadConfig } from '../config'
import type { Env } from '../types'
import { HttpError } from '../utils/http'

export type DivineVideoEvent = {
  id: string
  pubkey: string
  kind: number
  created_at: number
  content: string
  tags: string[][]
  sig?: string
}

type RecentVideosResponse = {
  events?: unknown[]
  videos?: unknown[]
  data?: unknown[]
  nextCursor?: unknown
  next_cursor?: unknown
  cursor?: unknown
}

function isEvent(value: unknown): value is DivineVideoEvent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<DivineVideoEvent>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.pubkey === 'string' &&
    typeof candidate.kind === 'number' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.content === 'string' &&
    Array.isArray(candidate.tags)
  )
}

function eventFromResponse(value: unknown): DivineVideoEvent | null {
  if (isEvent(value)) {
    return value
  }
  if (value && typeof value === 'object' && 'event' in value) {
    const event = (value as { event?: unknown }).event
    return isEvent(event) ? event : null
  }
  return null
}

async function getJson(url: string): Promise<unknown | null> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new HttpError(502, 'funnelcake_unavailable', 'funnelcake request failed')
  }

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new HttpError(502, 'funnelcake_unavailable', 'funnelcake request failed')
  }

  try {
    return await response.json()
  } catch {
    throw new HttpError(502, 'funnelcake_malformed_response', 'funnelcake response was malformed')
  }
}

export async function fetchVideoEvent(env: Env, eventId: string): Promise<DivineVideoEvent | null> {
  const config = loadConfig(env)
  const body = await getJson(`${config.funnelcakeUrl}/api/videos/${encodeURIComponent(eventId)}`)
  return body === null ? null : eventFromResponse(body)
}

function candidateEventId(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const record = candidate as { event_id?: unknown; eventId?: unknown; id?: unknown }
  if (typeof record.event_id === 'string') {
    return record.event_id
  }
  if (typeof record.eventId === 'string') {
    return record.eventId
  }
  return typeof record.id === 'string' ? record.id : null
}

function responseCandidates(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body
  }
  if (!body || typeof body !== 'object') {
    return []
  }
  const response = body as RecentVideosResponse
  if (Array.isArray(response.events)) {
    return response.events
  }
  if (Array.isArray(response.videos)) {
    return response.videos
  }
  return Array.isArray(response.data) ? response.data : []
}

function nextCursor(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined
  }
  const response = body as RecentVideosResponse
  const value = response.nextCursor ?? response.next_cursor ?? response.cursor
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export async function listRecentUserVideos(
  env: Env,
  input: { pubkey: string; cursor?: string; limit: number },
): Promise<{ events: DivineVideoEvent[]; nextCursor?: string }> {
  const config = loadConfig(env)
  const url = new URL(`${config.funnelcakeUrl}/api/v2/users/${encodeURIComponent(input.pubkey)}/videos`)
  if (input.cursor) {
    url.searchParams.set('cursor', input.cursor)
  }
  url.searchParams.set('limit', String(input.limit))

  const body = await getJson(url.toString())
  if (body === null) {
    return { events: [] }
  }

  const events: DivineVideoEvent[] = []
  for (const candidate of responseCandidates(body)) {
    const embedded = eventFromResponse(candidate)
    if (embedded) {
      events.push(embedded)
      continue
    }

    const id = candidateEventId(candidate)
    if (id) {
      const hydrated = await fetchVideoEvent(env, id)
      if (hydrated) {
        events.push(hydrated)
      }
    }
  }

  const cursor = nextCursor(body)
  return cursor ? { events, nextCursor: cursor } : { events }
}
