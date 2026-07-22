import { Hono } from 'hono'
import { connections } from './routes/connections'
import { crossposts } from './routes/crossposts'
import { health } from './routes/health'
import { platforms } from './routes/platforms'
import { preferences } from './routes/preferences'
import { webhooks } from './routes/webhooks'
import { processCrosspostJob, PublisherRetryError } from './services/publisher'
import { runAutoCrosspostReconciliation } from './services/reconciler'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()
app.route('/', health)
app.route('/', platforms)
app.route('/', connections)
app.route('/', preferences)
app.route('/', crossposts)
app.route('/', webhooks)

export { app }

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ jobId: string }>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await processCrosspostJob(env, message.body.jobId)
        if (result.retryDelaySeconds) {
          message.retry({ delaySeconds: result.retryDelaySeconds })
        } else {
          message.ack()
        }
      } catch (error) {
        if (error instanceof PublisherRetryError) {
          message.retry({ delaySeconds: error.retryDelaySeconds })
        } else {
          throw error
        }
      }
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runAutoCrosspostReconciliation(env)
  },
}
