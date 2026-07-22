import { describe, expect, it } from 'vitest'
import { webhooks } from './webhooks'
import type { Env } from '../types'

const env = { INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-secret' } as Env

describe('instagram webhooks', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    const response = await webhooks.request(
      '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=challenge-123',
      {},
      env,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('challenge-123')
  })

  it('rejects verification with a wrong token', async () => {
    const response = await webhooks.request(
      '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123',
      {},
      env,
    )
    expect(response.status).toBe(403)
  })

  it('rejects verification when no token is configured', async () => {
    const response = await webhooks.request(
      '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=&hub.challenge=challenge-123',
      {},
      {} as Env,
    )
    expect(response.status).toBe(403)
  })

  it('acknowledges webhook deliveries', async () => {
    const response = await webhooks.request(
      '/webhooks/instagram',
      { method: 'POST', body: JSON.stringify({ entry: [] }) },
      env,
    )
    expect(response.status).toBe(200)
  })
})
