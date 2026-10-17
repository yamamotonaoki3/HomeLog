import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { signAccessToken } from '../../lib/jwt'
import { requireAuth } from '../../middleware/auth'
import type { AppEnv } from '../../index'

async function insertUser() {
  const row = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(`testuser_mw_${crypto.randomUUID()}@example.com`, 'testuser_unused_hash', 'テスト太郎')
    .first<{ id: number }>()
  return row!.id
}

function buildTestApp() {
  const app = new Hono<AppEnv>()
  app.get('/protected', requireAuth, (c) => c.json({ userId: c.get('userId') }))
  return app
}

describe('requireAuth', () => {
  it('有効なアクセストークンがあればuserIdをコンテキストにセットして通す', async () => {
    const app = buildTestApp()
    const userId = await insertUser()
    const token = await signAccessToken(userId, env.JWT_SECRET, 900)

    const res = await app.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ userId })
  })

  it.each([
    ['退会の申し込み中', 'deletion_requested_at'],
    ['退会済み', 'deleted_at'],
  ])('%sのユーザーは有効なトークンでも401を返す (#297)', async (_label, column) => {
    const app = buildTestApp()
    const userId = await insertUser()
    await env.DB.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).bind(new Date().toISOString(), userId).run()
    const token = await signAccessToken(userId, env.JWT_SECRET, 900)

    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env)

    expect(res.status).toBe(401)
  })

  it('存在しないユーザーのトークンは401を返す', async () => {
    const app = buildTestApp()
    const token = await signAccessToken(2147483647, env.JWT_SECRET, 900)
    expect((await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env)).status).toBe(401)
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
