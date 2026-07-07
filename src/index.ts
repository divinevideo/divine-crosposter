import { Hono } from 'hono'
import { health } from './routes/health'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()
app.route('/', health)

export { app }

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ jobId: string }>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      message.ack()
    }
  },
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    return
  },
}
