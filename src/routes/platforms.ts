import { Hono } from 'hono'
import { getProviderSummaries } from '../platforms/registry'
import type { Env } from '../types'

export const platforms = new Hono<{ Bindings: Env }>()

platforms.get('/platforms', (c) => c.json({ platforms: getProviderSummaries(c.env) }))
