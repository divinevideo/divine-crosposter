import { Hono } from 'hono'
import type { Env } from '../types'

export const health = new Hono<{ Bindings: Env }>()

health.get('/health', (c) => c.json({ ok: true, service: 'divine-crossposter' }))
