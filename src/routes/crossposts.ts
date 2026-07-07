import { Hono } from 'hono'
import { authenticateRequest } from '../auth/keycast'
import {
  createAutomaticCrossposts,
  createManualCrossposts,
  getCrosspostJob,
  listVideoCrossposts,
} from '../services/crossposts'
import type { Env } from '../types'
import { errorResponse, HttpError, jsonResponse } from '../utils/http'

export const crossposts = new Hono<{ Bindings: Env }>()

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be JSON')
  }
}

function platformBody(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { platforms?: unknown }).platforms)) {
    throw new HttpError(400, 'invalid_platform', 'platforms must be an array')
  }
  const platforms = (body as { platforms: unknown[] }).platforms
  if (!platforms.every((platform) => typeof platform === 'string')) {
    throw new HttpError(400, 'invalid_platform', 'platforms must be strings')
  }
  return platforms
}

crossposts.post('/videos/:event_id/crossposts', async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env)
    const body = await parseJsonBody(c.req.raw)
    return jsonResponse(
      await createManualCrossposts(c.env, {
        pubkey: auth.pubkey,
        eventId: c.req.param('event_id'),
        platforms: platformBody(body),
      }),
    )
  } catch (error) {
    return errorResponse(error)
  }
})

crossposts.post('/videos/:event_id/auto-crosspost', async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env)
    return jsonResponse(
      await createAutomaticCrossposts(c.env, {
        pubkey: auth.pubkey,
        eventId: c.req.param('event_id'),
      }),
    )
  } catch (error) {
    return errorResponse(error)
  }
})

crossposts.get('/videos/:event_id/crossposts', async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env)
    return jsonResponse(await listVideoCrossposts(c.env, { pubkey: auth.pubkey, eventId: c.req.param('event_id') }))
  } catch (error) {
    return errorResponse(error)
  }
})

crossposts.get('/jobs/:job_id', async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env)
    return jsonResponse(await getCrosspostJob(c.env, { pubkey: auth.pubkey, jobId: c.req.param('job_id') }))
  } catch (error) {
    return errorResponse(error)
  }
})
