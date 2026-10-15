import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'

describe('GET /api/auth/me', () => {
  it.each(['名', '名'.repeat(50), 'a'.repeat(50)])('世帯未所属でも本人のidと表示名だけを返す (%s)', async (displayName) => {
    const insertUser = (email: string, name: string) => env.DB.prepare(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
    ).bind(email, 'testuser_unused_hash', name).first<{ id: number }>()
    const a = await insertUser(`testuser_me_${crypto.randomUUID()}@example.com`, displayName)
    const b = await insertUser(`testuser_me_${crypto.randomUUID()}@example.com`, 'testuser_other')
    for (const [user, name] of [[a!, displayName], [b!, 'testuser_other']] as const) {
      const token = await signAccessToken(user.id, env.JWT_SECRET, 60)
      const res = await app.request('/api/auth/me?userId=' + b!.id, {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: user.id, displayName: name })
    }
    // 古いJWTに表示名を埋め込まず、DBの現在値を返す。
    const token = await signAccessToken(a!.id, env.JWT_SECRET, 60)
    await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind('testuser_updated', a!.id).run()
    const updated = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(await updated.json()).toEqual({ id: a!.id, displayName: 'testuser_updated' })
  })

  it.each([undefined, 'Bearer invalid', 'Basic invalid', 'Bearer '])('認証なし・不正な認証を401にする (%s)', async (authorization) => {
    const res = await app.request('/api/auth/me', { headers: authorization ? { Authorization: authorization } : {} }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED', message: '認証が必要です' })
  })

  it('期限切れ・署名不正・ユーザー不存在を401にする', async () => {
    for (const token of [
      await signAccessToken(2147483647, env.JWT_SECRET, -60),
      await signAccessToken(2147483647, 'testuser_wrong_secret', 60),
      await signAccessToken(2147483647, env.JWT_SECRET, 60),
    ]) {
      const res = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED', message: '認証が必要です' })
    }
  })
})
