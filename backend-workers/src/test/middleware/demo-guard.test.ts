import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { DEMO_DISABLED_ROUTES } from '../../middleware/demo-guard'

// デモ環境(#532)で止めるAPI。メールは予約ドメインの架空値だけを使う。
const demoEnv = { ...env, DEMO_MODE: 'true' }
const json = { 'Content-Type': 'application/json' }
const EXPECTED = [
  'POST /api/auth/register', 'PUT /api/auth/password', 'PUT /api/auth/email', 'POST /api/auth/account/deletion',
  'POST /api/auth/account/deletion/cancel', 'POST /api/auth/password-reset/request', 'POST /api/auth/password-reset/confirm',
  'POST /api/households', 'POST /api/households/join', 'POST /api/households/leave', 'POST /api/households/invite-code/regenerate',
  'POST /api/recipes/ocr/upload', 'POST /api/recipes/ocr/analyze',
]

let userId: number
let authorization: string

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind('testuser_guard@example.com', 'testuser_unused_hash', 'testuser_guard')
    .first<{ id: number }>()
  userId = user!.id
  authorization = `Bearer ${await signAccessToken(userId, env.JWT_SECRET, 900)}`
})

const request = (method: string, path: string, testEnv: object) =>
  app.request(
    path,
    { method, headers: { ...json, Authorization: authorization }, body: method === 'GET' ? undefined : JSON.stringify({ email: 'testuser_new@example.com', password: 'TestPass123!', displayName: 'testuser_new', name: 'テスト世帯', inviteCode: 'TESTCODE' }) },
    testEnv,
  )

const counts = async () => {
  const [users, households, tokens] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM households'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens'),
  ])
  return [users.results[0].n, households.results[0].n, tokens.results[0].n]
}

describe('デモで止めるAPI', () => {
  it('止める13本は設計書4-1のとおり', () => {
    expect(DEMO_DISABLED_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual([...EXPECTED].sort())
  })

  it.each(EXPECTED)('%s は DEMO_MODE で 403 DEMO_DISABLED、DB に変化がない', async (entry) => {
    const [method, path] = entry.split(' ')
    const before = await counts()
    const res = await request(method, path, demoEnv)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'DEMO_DISABLED', message: 'デモでは使えません', details: [] })
    expect(await counts()).toEqual(before)
    const stored = await env.DB.prepare('SELECT deletion_requested_at AS d, email FROM users WHERE id = ?').bind(userId).first()
    expect(stored).toEqual({ d: null, email: 'testuser_guard@example.com' })
  })

  it.each(EXPECTED)('%s は末尾に / を付けても DEMO_MODE で 403 になり、DB に変化がない', async (entry) => {
    const [method, path] = entry.split(' ')
    const before = await counts()
    const res = await request(method, `${path}/`, demoEnv)
    expect(res.status).toBe(403)
    expect(await counts()).toEqual(before)
  })

  it.each(EXPECTED)('%s は DEMO_MODE なしでは 403 にならない', async (entry) => {
    const [method, path] = entry.split(' ')
    const res = await request(method, path, env)
    expect(res.status).not.toBe(403)
    expect(await res.text()).not.toContain('DEMO_DISABLED')
  })

  it('DEMO_MODE なしの登録は従来どおり成功する', async () => {
    const res = await request('POST', '/api/auth/register', env)
    expect(res.status).toBe(201)
  })

  it('表示名の変更（PATCH /api/auth/account）と URL 登録は DEMO_MODE でも止めない', async () => {
    const patch = await app.request('/api/auth/account', { method: 'PATCH', headers: { ...json, Authorization: authorization }, body: JSON.stringify({ displayName: 'testuser_renamed' }) }, demoEnv)
    expect(patch.status).toBe(200)
    const fromUrl = await request('POST', '/api/recipes/from-url', demoEnv)
    expect(fromUrl.status).not.toBe(403)
    expect(await fromUrl.text()).not.toContain('DEMO_DISABLED')
  })

  it('メソッドとパスの完全一致だけを止める（GET や別のパスは止めない）', async () => {
    expect((await request('GET', '/api/households/me', demoEnv)).status).not.toBe(403)
    expect((await request('GET', '/api/auth/password', demoEnv)).status).not.toBe(403)
    expect((await request('POST', '/api/auth/login', demoEnv)).status).not.toBe(403)
  })
})
