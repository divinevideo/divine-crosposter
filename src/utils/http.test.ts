import { describe, expect, it } from 'vitest'
import { HttpError, errorResponse, jsonResponse } from './http'

describe('http helpers', () => {
  it('returns JSON responses with status codes', async () => {
    const response = jsonResponse({ ok: true }, 201)

    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('maps HttpError values to JSON error responses', async () => {
    const response = errorResponse(new HttpError(403, 'forbidden', 'nope'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'forbidden', message: 'nope' },
    })
  })

  it('maps unexpected errors to internal server errors', async () => {
    const response = errorResponse(new Error('boom'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'internal_error', message: 'internal server error' },
    })
  })
})
