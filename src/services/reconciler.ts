import {
  AUTO_RECONCILE_MAX_USERS_PER_RUN,
  AUTO_RECONCILE_QUEUED_JOB_LIMIT,
  AUTO_RECONCILE_USER_BATCH_SIZE,
  AUTO_RECONCILE_VIDEO_LIMIT_PER_USER,
} from '../config'
import { getCursor, upsertCursor } from '../db/cursors'
import { listRunnableJobs, recoverStaleXClaims } from '../db/jobs'
import { expireStartedOAuthAttempts } from '../db/oauth-attempts'
import { deleteExpiredOAuthStates } from '../db/oauth-states'
import { listAutomaticPreferences } from '../db/preferences'
import { listRecentUserVideos } from '../funnelcake/client'
import type { DivineVideoEvent } from '../funnelcake/client'
import type { Env, PreferenceRecord } from '../types'
import { createAutomaticCrossposts } from './crossposts'

export type ReconciliationResult = {
  usersChecked: number
  eventsChecked: number
  jobsCreatedOrFound: number
  queuedJobsEnqueued: number
  oauthAttemptsExpired: number
  oauthStatesDeleted: number
  uploadingRecovered: number
  dispatchingFailed: number
}

function groupPreferencesByPubkey(preferences: PreferenceRecord[]): Map<string, PreferenceRecord[]> {
  const grouped = new Map<string, PreferenceRecord[]>()
  for (const preference of preferences) {
    const current = grouped.get(preference.pubkey) ?? []
    current.push(preference)
    grouped.set(preference.pubkey, current)
  }
  return grouped
}

function hasEligibleAutomaticPreference(event: DivineVideoEvent, preferences: PreferenceRecord[]): boolean {
  return preferences.some(
    (preference) =>
      preference.mode === 'automatic' &&
      preference.connectionId !== null &&
      (preference.automaticEnabledAt === null || event.created_at >= preference.automaticEnabledAt),
  )
}

function newestEventTimestamp(events: DivineVideoEvent[], fallback: number): number {
  if (events.length === 0) return fallback
  return events.reduce((latest, event) => Math.max(latest, event.created_at), 0)
}

function nextLastCheckedAt(events: DivineVideoEvent[], previous: number | null, now: number): number {
  const inspectedAt = newestEventTimestamp(events, previous ?? now)
  return Math.max(previous ?? 0, inspectedAt)
}

export async function runAutoCrosspostReconciliation(
  env: Env,
  options: { now?: number } = {},
): Promise<ReconciliationResult> {
  const now = options.now ?? Math.floor(Date.now() / 1_000)
  let offset = 0
  let usersChecked = 0
  let eventsChecked = 0
  let jobsCreatedOrFound = 0
  let queuedJobsEnqueued = 0
  const oauthAttemptsExpired = await expireStartedOAuthAttempts(env.DB, now)
  const oauthStatesDeleted = await deleteExpiredOAuthStates(env.DB, now)
  const { uploadingRecovered, dispatchingFailed } = await recoverStaleXClaims(env.DB, now, 5 * 60)

  const runnableJobs = await listRunnableJobs(env.DB, now, AUTO_RECONCILE_QUEUED_JOB_LIMIT)
  for (const job of runnableJobs) {
    await env.CROSSPOST_QUEUE.send({ jobId: job.id })
    queuedJobsEnqueued += 1
  }

  while (usersChecked < AUTO_RECONCILE_MAX_USERS_PER_RUN) {
    const preferences = await listAutomaticPreferences(env.DB, AUTO_RECONCILE_USER_BATCH_SIZE, offset)
    if (preferences.length === 0) break
    offset += preferences.length

    const grouped = groupPreferencesByPubkey(preferences)
    for (const [pubkey, userPreferences] of grouped) {
      if (usersChecked >= AUTO_RECONCILE_MAX_USERS_PER_RUN) break
      usersChecked += 1

      const cursor = await getCursor(env.DB, pubkey)
      const recent = await listRecentUserVideos(env, {
        pubkey,
        cursor: cursor?.cursor ?? undefined,
        limit: AUTO_RECONCILE_VIDEO_LIMIT_PER_USER,
      })

      for (const event of recent.events) {
        if (cursor && event.created_at <= cursor.lastCheckedAt) {
          continue
        }
        eventsChecked += 1
        if (!hasEligibleAutomaticPreference(event, userPreferences)) {
          continue
        }
        const result = await createAutomaticCrossposts(env, { pubkey, eventId: event.id })
        jobsCreatedOrFound += result.jobs.length
      }

      await upsertCursor(env.DB, {
        pubkey,
        cursor: recent.nextCursor ?? cursor?.cursor ?? null,
        lastCheckedAt: nextLastCheckedAt(recent.events, cursor?.lastCheckedAt ?? null, now),
        updatedAt: now,
      })
    }
  }

  return {
    usersChecked,
    eventsChecked,
    jobsCreatedOrFound,
    queuedJobsEnqueued,
    oauthAttemptsExpired,
    oauthStatesDeleted,
    uploadingRecovered,
    dispatchingFailed,
  }
}
