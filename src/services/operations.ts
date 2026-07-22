import {
  countOverdueRunnableJobs,
  getOldestUnconsumedAlertTest,
  markAlertTestConsumed,
} from '../db/operations'
import type { Env } from '../types'

const OVERDUE_GRACE_SECONDS = 15 * 60

export type OperationalIssue = {
  service: 'divine-crossposter'
  observedAt: number
  issue: 'primary_jobs_overdue' | 'dlq_nonempty' | 'notification_test'
  backlogCount: number
  backlogBytes: number
  overdueJobCount: number
}

function issue(
  observedAt: number,
  code: OperationalIssue['issue'],
  metrics: QueueMetrics,
  overdueJobCount: number,
): OperationalIssue {
  return {
    service: 'divine-crossposter',
    observedAt,
    issue: code,
    backlogCount: metrics.backlogCount,
    backlogBytes: metrics.backlogBytes,
    overdueJobCount,
  }
}

export async function runOperationalChecks(env: Env, now: number): Promise<OperationalIssue[]> {
  if (!env.CROSSPOST_DLQ) return []

  const [primaryMetrics, dlqMetrics] = await Promise.all([
    env.CROSSPOST_QUEUE.metrics(),
    env.CROSSPOST_DLQ.metrics(),
  ])
  const overdueJobCount = await countOverdueRunnableJobs(env.DB, now, OVERDUE_GRACE_SECONDS)
  const issues: OperationalIssue[] = []
  if (overdueJobCount > 0) {
    issues.push(issue(now, 'primary_jobs_overdue', primaryMetrics, overdueJobCount))
  }
  if (dlqMetrics.backlogCount > 0) {
    issues.push(issue(now, 'dlq_nonempty', dlqMetrics, overdueJobCount))
  }

  const alertTest = await getOldestUnconsumedAlertTest(env.DB)
  if (alertTest) {
    issues.push(issue(now, 'notification_test', primaryMetrics, overdueJobCount))
  }
  if (issues.length === 0) return issues

  if (!env.OPS_ALERT_WEBHOOK_URL) {
    console.warn('crossposter operational issues', issues)
    return issues
  }

  const response = await fetch(env.OPS_ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(issues),
  })
  if (!response.ok) throw new Error(`operations alert webhook failed with status ${response.status}`)
  if (alertTest) await markAlertTestConsumed(env.DB, alertTest.id, now)
  return issues
}
