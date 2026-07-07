import type { DivineVideoEvent } from '../funnelcake/client'
import { fetchVideoEvent } from '../funnelcake/client'
import { listAttempts } from '../db/attempts'
import { getActiveConnectionForPlatform, getConnection } from '../db/connections'
import { createOrGetJob, getJob, listJobsForVideo } from '../db/jobs'
import { getPreferences } from '../db/preferences'
import { getAdapter } from '../platforms/registry'
import type { ConnectionRecord, Env, JobAttemptRecord, JobRecord, Platform, PreferenceRecord } from '../types'
import { generateRandomId } from '../utils/crypto'
import { HttpError } from '../utils/http'
import { isValidEventId, parsePlatform } from '../utils/validation'

export type CrosspostJobsResult = {
  jobs: JobRecord[]
}

export type JobWithAttemptsResult = {
  job: JobRecord
  attempts: JobAttemptRecord[]
}

type SourceSnapshot = {
  mediaUrl: string
  mediaHash: string
  caption: string
  createdAt: number
}

const VIDEO_KIND = 34236
const JOB_EXPIRATION_SECONDS = 48 * 60 * 60
const ALLOWED_MEDIA_HOSTS = new Set([
  'media.divine.video',
  'cdn.divine.video',
  'blossom.divine.video',
  'media.dvines.org',
  'cdn.dvines.org',
  'blossom.dvines.org',
])

function ensureEventId(value: string): string {
  if (!isValidEventId(value)) {
    throw new HttpError(400, 'invalid_event_id', 'invalid event id')
  }
  return value.toLowerCase()
}

function tagValue(tags: string[][], name: string): string | null {
  const tag = tags.find((candidate) => candidate[0] === name && typeof candidate[1] === 'string')
  return tag?.[1] ?? null
}

function imetaValue(tags: string[][], name: string): string | null {
  for (const tag of tags) {
    if (tag[0] !== 'imeta') {
      continue
    }
    for (let index = 1; index < tag.length - 1; index += 2) {
      if (tag[index] === name && tag[index + 1]) {
        return tag[index + 1]
      }
    }
    for (const entry of tag.slice(1)) {
      const separator = entry.indexOf(' ')
      if (separator === -1) continue
      if (entry.slice(0, separator) === name) {
        const value = entry.slice(separator + 1).trim()
        if (value) return value
      }
    }
  }
  return null
}

function isUsableMediaUrl(value: string | null): value is string {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ALLOWED_MEDIA_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function mediaUrl(event: DivineVideoEvent): string | null {
  const candidates = [
    imetaValue(event.tags, 'url'),
    tagValue(event.tags, 'url'),
    tagValue(event.tags, 'media'),
    tagValue(event.tags, 'r'),
  ]
  return candidates.find(isUsableMediaUrl) ?? null
}

function mediaHash(event: DivineVideoEvent): string | null {
  return imetaValue(event.tags, 'x') ?? tagValue(event.tags, 'x') ?? tagValue(event.tags, 'sha256') ?? tagValue(event.tags, 'hash')
}

function isArchiveLabeled(event: DivineVideoEvent): boolean {
  return event.tags.some((tag) => {
    const [name, value] = tag
    return (
      (name === 'L' && value === 'archive.divine.video') ||
      (name === 'l' && value === 'vine-archive') ||
      (name === 't' && value === 'vine-archive')
    )
  })
}

function isRepost(event: DivineVideoEvent): boolean {
  return event.kind === 16 || event.tags.some((tag) => tag[0] === 'k' && tag[1] === String(VIDEO_KIND) && tag[2] === 'repost')
}

function validateEvent(event: DivineVideoEvent | null, pubkey: string, eventId: string): SourceSnapshot {
  if (!event) {
    throw new HttpError(404, 'not_found', 'video event not found')
  }
  if (event.pubkey.toLowerCase() !== pubkey) {
    throw new HttpError(403, 'not_owner', 'video does not belong to authenticated user')
  }
  if (event.id.toLowerCase() !== eventId || event.kind !== VIDEO_KIND || isArchiveLabeled(event) || isRepost(event)) {
    throw new HttpError(400, 'not_eligible', 'video is not eligible for crossposting')
  }

  const url = mediaUrl(event)
  const hash = mediaHash(event)
  if (!url || !hash) {
    throw new HttpError(400, 'not_eligible', 'video is missing media url or hash')
  }

  return {
    mediaUrl: url,
    mediaHash: hash,
    caption: event.content,
    createdAt: event.created_at,
  }
}

function uniquePlatforms(platforms: string[]): Platform[] {
  return [...new Set(platforms.map(parsePlatform))]
}

async function enqueueNewJobs(env: Env, createdJobs: JobRecord[]): Promise<void> {
  for (const job of createdJobs) {
    await env.CROSSPOST_QUEUE.send({ jobId: job.id })
  }
}

async function createJobsForConnections(
  env: Env,
  input: {
    pubkey: string
    eventId: string
    snapshot: SourceSnapshot
    connections: ConnectionRecord[]
  },
): Promise<CrosspostJobsResult> {
  const now = Math.floor(Date.now() / 1_000)
  const jobs: JobRecord[] = []
  const createdJobs: JobRecord[] = []

  for (const connection of input.connections) {
    const result = await createOrGetJob(env.DB, {
      id: `job_${generateRandomId()}`,
      pubkey: input.pubkey,
      videoEventId: input.eventId,
      platform: connection.platform,
      connectionId: connection.id,
      externalAccountId: connection.externalAccountId,
      sourceMediaUrl: input.snapshot.mediaUrl,
      sourceMediaHash: input.snapshot.mediaHash,
      caption: input.snapshot.caption,
      status: 'queued',
      expiresAt: now + JOB_EXPIRATION_SECONDS,
      createdAt: now,
      updatedAt: now,
    })
    jobs.push(result.job)
    if (result.created) {
      createdJobs.push(result.job)
    }
  }

  await enqueueNewJobs(env, createdJobs)
  return { jobs }
}

async function requireManualConnection(env: Env, pubkey: string, platform: Platform): Promise<ConnectionRecord> {
  if (!getAdapter(env, platform)) {
    throw new HttpError(400, 'not_connected', 'platform is not enabled')
  }
  const connection = await getActiveConnectionForPlatform(env.DB, pubkey, platform)
  if (!connection) {
    throw new HttpError(400, 'not_connected', 'platform is not connected')
  }
  return connection
}

export async function createManualCrossposts(
  env: Env,
  input: { pubkey: string; eventId: string; platforms: string[] },
): Promise<CrosspostJobsResult> {
  const eventId = ensureEventId(input.eventId)
  if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
    throw new HttpError(400, 'invalid_platform', 'at least one platform is required')
  }

  const platforms = uniquePlatforms(input.platforms)
  const connections = await Promise.all(platforms.map((platform) => requireManualConnection(env, input.pubkey, platform)))
  const snapshot = validateEvent(await fetchVideoEvent(env, eventId), input.pubkey, eventId)
  return createJobsForConnections(env, { pubkey: input.pubkey, eventId, snapshot, connections })
}

function isAutomaticPreference(preference: PreferenceRecord): boolean {
  return preference.mode === 'automatic' && preference.connectionId !== null
}

export async function createAutomaticCrossposts(
  env: Env,
  input: { pubkey: string; eventId: string },
): Promise<CrosspostJobsResult> {
  const eventId = ensureEventId(input.eventId)
  const snapshot = validateEvent(await fetchVideoEvent(env, eventId), input.pubkey, eventId)
  const preferences = (await getPreferences(env.DB, input.pubkey)).filter(isAutomaticPreference)
  const connections: ConnectionRecord[] = []

  for (const preference of preferences) {
    if (!getAdapter(env, preference.platform)) {
      continue
    }
    if (preference.automaticEnabledAt !== null && snapshot.createdAt < preference.automaticEnabledAt) {
      continue
    }
    const connection = await getConnection(env.DB, preference.connectionId as string, input.pubkey)
    if (connection?.status === 'connected') {
      connections.push(connection)
    }
  }

  return createJobsForConnections(env, { pubkey: input.pubkey, eventId, snapshot, connections })
}

export async function listVideoCrossposts(
  env: Env,
  input: { pubkey: string; eventId: string },
): Promise<CrosspostJobsResult> {
  return { jobs: await listJobsForVideo(env.DB, input.pubkey, ensureEventId(input.eventId)) }
}

export async function getCrosspostJob(
  env: Env,
  input: { pubkey: string; jobId: string },
): Promise<JobWithAttemptsResult> {
  const job = await getJob(env.DB, input.jobId, input.pubkey)
  if (!job) {
    throw new HttpError(404, 'not_found', 'job not found')
  }
  return { job, attempts: await listAttempts(env.DB, job.id) }
}
