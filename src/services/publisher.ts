import { listAttempts, recordAttempt } from '../db/attempts'
import { getConnection, markConnectionNeedsReauth, upsertConnection } from '../db/connections'
import { claimJobForPublish, claimJobForStatusPoll, getJob, updateJobStatus } from '../db/jobs'
import { getAdapter } from '../platforms/registry'
import { PlatformAdapterError, asRecord } from '../platforms/adapter'
import type { Env, ErrorCode, JobAttemptRecord, JobRecord, JobStatus } from '../types'
import { decryptToken, encryptToken, generateRandomId } from '../utils/crypto'
import { sanitizeProviderMetadata } from '../utils/provider-metadata'

const BACKOFF_SECONDS = [60, 300, 900, 1800, 3600] as const
const MAX_RETRY_COUNT = BACKOFF_SECONDS.length

export type ProcessCrosspostResult = {
  status: JobStatus | 'not_found'
  retryDelaySeconds?: number
}

export class PublisherRetryError extends Error {
  constructor(public readonly retryDelaySeconds: number) {
    super('crosspost job should be retried')
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function backoffSeconds(retryCount: number): number {
  return BACKOFF_SECONDS[Math.min(retryCount, BACKOFF_SECONDS.length - 1)]
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ error: 'unserializable_provider_response' })
  }
}

function retryableCode(code: ErrorCode): boolean {
  return code === 'rate_limited' || code === 'unknown_platform_error' || code === 'processing_timeout'
}

async function addAttempt(
  env: Env,
  input: {
    jobId: string
    status: JobStatus
    errorCode?: ErrorCode | null
    errorMessage?: string | null
    providerStatus?: number | null
    providerResponse?: unknown
    now: number
  },
): Promise<void> {
  const attempt: JobAttemptRecord = {
    id: `attempt_${generateRandomId()}`,
    jobId: input.jobId,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    providerStatus: input.providerStatus ?? null,
    providerResponseJson:
      input.providerResponse === undefined || input.providerResponse === null ? null : safeJson(input.providerResponse),
    createdAt: input.now,
  }
  await recordAttempt(env.DB, attempt)
}

async function accessTokenForJob(env: Env, job: JobRecord, now: number): Promise<string | null> {
  const connection = await getConnection(env.DB, job.connectionId, job.pubkey)
  if (!connection || connection.status !== 'connected') {
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'needs_reauth',
      updatedAt: now,
      errorCode: 'needs_reauth',
      errorMessage: 'connection is not active',
    })
    return null
  }

  const adapter = getAdapter(env, job.platform)
  if (!adapter) {
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'failed',
      updatedAt: now,
      errorCode: 'not_connected',
      errorMessage: 'platform is not enabled',
    })
    return null
  }

  if (!connection.tokenExpiresAt || connection.tokenExpiresAt > now + 60 || !connection.encryptedRefreshToken) {
    return decryptToken(connection.encryptedAccessToken, env.TOKEN_ENCRYPTION_KEY)
  }

  try {
    const refreshed = await adapter.refreshToken({
      refreshToken: await decryptToken(connection.encryptedRefreshToken, env.TOKEN_ENCRYPTION_KEY),
    })
    const encryptedAccessToken = await encryptToken(refreshed.accessToken, env.TOKEN_ENCRYPTION_KEY)
    const encryptedRefreshToken = refreshed.refreshToken
      ? await encryptToken(refreshed.refreshToken, env.TOKEN_ENCRYPTION_KEY)
      : connection.encryptedRefreshToken
    await upsertConnection(env.DB, {
      ...connection,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt: refreshed.expiresAt ?? connection.tokenExpiresAt,
      grantedScopes: refreshed.scopes.length ? refreshed.scopes.join(' ') : connection.grantedScopes,
      lastRefreshAt: now,
      updatedAt: now,
      metadataJson: safeJson({
        ...asRecord(JSON.parse(connection.metadataJson || '{}')),
        token: sanitizeProviderMetadata(refreshed.metadata),
      }),
    })
    return refreshed.accessToken
  } catch (error) {
    if (error instanceof PlatformAdapterError && error.code === 'needs_reauth') {
      await markConnectionNeedsReauth(env.DB, connection.id, now)
      await updateJobStatus(env.DB, {
        id: job.id,
        status: 'needs_reauth',
        updatedAt: now,
        errorCode: 'needs_reauth',
        errorMessage: error.message,
      })
      await addAttempt(env, {
        jobId: job.id,
        status: 'needs_reauth',
        errorCode: 'needs_reauth',
        errorMessage: error.message,
        providerStatus: error.providerStatus ?? null,
        providerResponse: error.providerResponse,
        now,
      })
      return null
    }
    throw error
  }
}

function latestProviderResponse(attempts: JobAttemptRecord[]): Record<string, unknown> {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const json = attempts[index].providerResponseJson
    if (!json) continue
    try {
      return asRecord(JSON.parse(json))
    } catch {
      return {}
    }
  }
  return {}
}

function pollProviderResponse(job: JobRecord, attempts: JobAttemptRecord[]): Record<string, unknown> {
  const latest = latestProviderResponse(attempts)
  if (Object.keys(latest).length > 0) return latest
  if (!job.externalPostId) return {}

  if (job.platform === 'x') {
    return { mediaId: job.externalPostId, caption: job.caption }
  }
  return { publish_id: job.externalPostId }
}

async function scheduleRetry(env: Env, job: JobRecord, code: ErrorCode, message: string, now: number): Promise<number | null> {
  const retryCount = job.retryCount + 1
  if (retryCount > MAX_RETRY_COUNT) {
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'failed',
      updatedAt: now,
      retryCount,
      errorCode: code,
      errorMessage: message,
      nextRetryAt: null,
    })
    return null
  }

  const delay = backoffSeconds(job.retryCount)
  await updateJobStatus(env.DB, {
    id: job.id,
    status: code === 'processing_timeout' ? 'processing' : 'failed',
    updatedAt: now,
    retryCount,
    errorCode: code,
    errorMessage: message,
    nextRetryAt: now + delay,
  })
  return delay
}

async function markResult(
  env: Env,
  job: JobRecord,
  result: {
    status: 'posted' | 'processing'
    externalPostId?: string
    externalPostUrl?: string
    providerResponse: Record<string, unknown>
  },
  now: number,
  countProcessingRetry = false,
): Promise<ProcessCrosspostResult> {
  await addAttempt(env, {
    jobId: job.id,
    status: result.status,
    providerResponse: result.providerResponse,
    now,
  })

  if (result.status === 'posted') {
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'posted',
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
      externalPostId: result.externalPostId ?? null,
      externalPostUrl: result.externalPostUrl ?? null,
      nextRetryAt: null,
    })
    return { status: 'posted' }
  }

  if (countProcessingRetry) {
    const delay = await scheduleRetry(env, job, 'processing_timeout', 'platform publish is still processing', now)
    if (delay === null) {
      return { status: 'failed' }
    }
    return { status: 'processing', retryDelaySeconds: delay }
  }

  const delay = backoffSeconds(job.retryCount)
  await updateJobStatus(env.DB, {
    id: job.id,
    status: 'processing',
    updatedAt: now,
    errorCode: null,
    errorMessage: null,
    externalPostId: result.externalPostId ?? null,
    externalPostUrl: result.externalPostUrl ?? null,
    nextRetryAt: now + delay,
  })
  return { status: 'processing', retryDelaySeconds: delay }
}

async function handleProviderError(env: Env, job: JobRecord, error: PlatformAdapterError, now: number): Promise<ProcessCrosspostResult> {
  await addAttempt(env, {
    jobId: job.id,
    status: error.code === 'needs_reauth' ? 'needs_reauth' : 'failed',
    errorCode: error.code,
    errorMessage: error.message,
    providerStatus: error.providerStatus ?? null,
    providerResponse: error.providerResponse,
    now,
  })

  if (error.code === 'needs_reauth') {
    await markConnectionNeedsReauth(env.DB, job.connectionId, now)
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'needs_reauth',
      updatedAt: now,
      errorCode: 'needs_reauth',
      errorMessage: error.message,
      nextRetryAt: null,
    })
    return { status: 'needs_reauth' }
  }

  if (!retryableCode(error.code)) {
    await updateJobStatus(env.DB, {
      id: job.id,
      status: 'failed',
      updatedAt: now,
      errorCode: error.code,
      errorMessage: error.message,
      nextRetryAt: null,
    })
    return { status: 'failed' }
  }

  const delay = await scheduleRetry(env, job, error.code, error.message, now)
  if (delay === null) return { status: 'failed' }
  throw new PublisherRetryError(delay)
}

export async function processCrosspostJob(env: Env, jobId: string, options: { now?: number } = {}): Promise<ProcessCrosspostResult> {
  const now = options.now ?? nowSeconds()
  const existing = await getJob(env.DB, jobId)
  if (!existing) return { status: 'not_found' }

  if (existing.expiresAt <= now) {
    await updateJobStatus(env.DB, {
      id: existing.id,
      status: 'skipped',
      updatedAt: now,
      errorCode: 'expired',
      errorMessage: 'crosspost job expired',
      nextRetryAt: null,
    })
    return { status: 'skipped' }
  }

  const adapter = getAdapter(env, existing.platform)
  if (!adapter) {
    await updateJobStatus(env.DB, {
      id: existing.id,
      status: 'failed',
      updatedAt: now,
      errorCode: 'not_connected',
      errorMessage: 'platform is not enabled',
    })
    return { status: 'failed' }
  }

  const job =
    existing.status === 'processing'
      ? await claimJobForStatusPoll(env.DB, existing.id, now)
      : await claimJobForPublish(env.DB, existing.id, now)
  if (!job) {
    return { status: existing.status }
  }

  try {
    const accessToken = await accessTokenForJob(env, job, now)
    if (!accessToken) return { status: 'needs_reauth' }

    if (existing.status === 'processing') {
      if (!adapter.pollPublishStatus) {
        const delay = await scheduleRetry(env, job, 'processing_timeout', 'platform publish is still processing', now)
        return delay === null ? { status: 'failed' } : { status: 'processing', retryDelaySeconds: delay }
      }
      const attempts = await listAttempts(env.DB, job.id)
      const result = await adapter.pollPublishStatus({
        accessToken,
        providerResponse: pollProviderResponse(job, attempts),
      })
      return markResult(env, job, result, now, true)
    }

    const result = await adapter.publishVideo({
      accessToken,
      videoUrl: job.sourceMediaUrl,
      mediaHash: job.sourceMediaHash,
      caption: job.caption,
      externalAccountId: job.externalAccountId,
    })
    return markResult(env, job, result, now)
  } catch (error) {
    if (error instanceof PlatformAdapterError) {
      return handleProviderError(env, job, error, now)
    }
    const platformError = new PlatformAdapterError(job.platform, 'unknown_platform_error', 'publisher failed')
    return handleProviderError(env, job, platformError, now)
  }
}
