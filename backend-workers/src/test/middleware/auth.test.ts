import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { signAccessToken } from '../../lib/jwt'
import { requireAuth } from '../../middleware/auth'
import type { AppEnv } from '../../index'

function buildTestApp() {
  const app = new Hono<AppEnv>()
  app.get('/protected', requireAuth, (c) => c.json({ userId: c.get('userId') }))
  return app
}

describe('requireAuth', () => {
  it('有効なアクセストークンがあればuserIdをコンテキストにセットして通す', async () => {
    const app = buildTestApp()
    const token = await signAccessToken(42, env.JWT_SECRET, 900)

    const res = await app.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ userId: 42 })
  })

  it('Authorizationヘッダーが無い場合は401を返す', async () => {
    const app = buildTestApp()

    const res = await app.request('/protected', {}, env)

    expect(res.status).toBe(401)
    const body = await res.json<{ code: string }>()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('不正なトークンの場合は401を返す', async () => {
    const app = buildTestApp()

    const res = await app.request(
      '/protected',
      { headers: { Authorization: 'Bearer invalid-token' } },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('期限切れのトークンの場合は401を返す', async () => {
    const app = buildTestApp()
    const token = await signAccessToken(42, env.JWT_SECRET, -1)

    const res = await app.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    )

    expect(res.status).toBe(401)
  })
})
