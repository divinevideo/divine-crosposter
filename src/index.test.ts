import { describe, expect, it } from 'vitest'
import { app } from './index'

describe('health route', () => {
  it('returns branded service identity at root', async () => {
    const res = await app.request('/')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: 'divine-crossposter',
      name: 'Divine Crossposter',
      endpoints: {
        health: '/health',
        platforms: '/platforms',
      },
    })
  })

  it('returns service health', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, service: 'divine-crossposter' })
  })
})
