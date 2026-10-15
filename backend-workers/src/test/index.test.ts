import { describe, expect, it } from 'vitest'
import app from '../index'

describe('GET /health', () => {
  it('200とstatus okを返す', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
  })
})

describe('未知API', () => {
  it.each(['/api', '/api/not-found'])('%sはHTMLではなく404を返す', async (path) => {
    const res = await app.request(path)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).not.toContain('text/html')
  })
})
