import { Hono } from 'hono'
import type { Env } from '../types'

// Meta webhook endpoint for the Instagram use case. Verification: Meta sends a
// GET with hub.verify_token, which must match INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
// and the response must echo hub.challenge. Deliveries are acknowledged but not
// yet consumed; crossposting does not depend on webhooks.
export const webhooks = new Hono<{ Bindings: Env }>()

webhooks.get('/webhooks/instagram', (c) => {
  const expected = c.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')
  if (mode === 'subscribe' && expected && token === expected && typeof challenge === 'string') {
    return c.text(challenge, 200)
  }
  return c.text('forbidden', 403)
})

webhooks.post('/webhooks/instagram', (c) => c.text('ok', 200))
