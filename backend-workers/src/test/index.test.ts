import { describe, expect, it } from 'vitest'
import app from '../index'

describe('GET /health', () => {
  it('200とstatus okを返す', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
  })
})
