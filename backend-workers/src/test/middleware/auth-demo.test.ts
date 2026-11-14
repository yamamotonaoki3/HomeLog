import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../../index'
import { findDemoMembership, isExpiredDemoUser } from '../../lib/demo'
import { sha256Hex } from '../../lib/crypto'
import { signAccessToken } from '../../lib/jwt'

// デモ利用者・デモ世帯は SQL で直接作る。メールは予約ドメインの架空値だけ。
const demoEnv = { ...env, DEMO_MODE: 'true' }
const HOUR = 3_600_000

async function insertUser(label: string): Promise<number> {
  const row = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(`testuser_demo_${label}_${crypto.randomUUID()}@example.com`, 'testuser_unused_hash', `testuser_${label}`)
    .first<{ id: number }>()
  return row!.id
}

async function insertDemo(expiresAt: Date) {
  const primaryUserId = await insertUser('primary')
  const partnerUserId = await insertUser('partner')
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', crypto.randomUUID().slice(0, 16))
    .first<{ id: number }>()
  await env.DB.prepare('INSERT INTO demo_households (household_id, primary_user_id, partner_user_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(household!.id, primaryUserId, partnerUserId, expiresAt.toISOString())
    .run()
  return { householdId: household!.id, primaryUserId, partnerUserId }
}

const me = async (userId: number, testEnv: object) =>
  app.request('/api/auth/me', { headers: { Authorization: `Bearer ${await signAccessToken(userId, env.JWT_SECRET, 900)}` } }, testEnv)

async function insertRefreshToken(userId: number): Promise<string> {
  const token = `testtoken_${crypto.randomUUID()}`
  await env.DB.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .bind(userId, await sha256Hex(token), new Date(Date.now() + 24 * HOUR).toISOString())
    .run()
  return token
}

const refresh = (token: string, testEnv: object) =>
  app.request('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: token }) }, testEnv)

describe('デモ利用者の期限切れ判定', () => {
  it('期限切れのデモ利用者は DEMO_MODE で 401', async () => {
    const demo = await insertDemo(new Date(Date.now() - HOUR))
    for (const userId of [demo.primaryUserId, demo.partnerUserId]) {
      const res = await me(userId, demoEnv)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    }
  })

  it('期限内のデモ利用者は 200', async () => {
    const demo = await insertDemo(new Date(Date.now() + HOUR))
    expect((await me(demo.primaryUserId, demoEnv)).status).toBe(200)
    expect((await me(demo.partnerUserId, demoEnv)).status).toBe(200)
  })

  it('DEMO_MODE なしでは期限切れの行があっても 200（本番では判定しない）', async () => {
    const demo = await insertDemo(new Date(Date.now() - HOUR))
    expect((await me(demo.primaryUserId, env)).status).toBe(200)
  })

  it('期限切れのデモ利用者の POST /api/auth/refresh は DEMO_MODE で 401', async () => {
    const demo = await insertDemo(new Date(Date.now() - HOUR))
    const token = await insertRefreshToken(demo.primaryUserId)
    const res = await refresh(token, demoEnv)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' })
  })

  it('期限内のデモ利用者の refresh は DEMO_MODE でも 200', async () => {
    const demo = await insertDemo(new Date(Date.now() + HOUR))
    expect((await refresh(await insertRefreshToken(demo.primaryUserId), demoEnv)).status).toBe(200)
  })

  it('DEMO_MODE なしでは期限切れの行があっても refresh は従来どおり 200', async () => {
    const demo = await insertDemo(new Date(Date.now() - HOUR))
    expect((await refresh(await insertRefreshToken(demo.primaryUserId), env)).status).toBe(200)
  })

  it('findDemoMembership はどちらの利用者からも同じ行を返し、通常の利用者では null', async () => {
    const expires = new Date(Date.now() + HOUR)
    const demo = await insertDemo(expires)
    const expected = { ...demo, expiresAt: expires.toISOString() }
    expect(await findDemoMembership(env.DB, demo.primaryUserId)).toEqual(expected)
    expect(await findDemoMembership(env.DB, demo.partnerUserId)).toEqual(expected)
    expect(await findDemoMembership(env.DB, await insertUser('normal'))).toBeNull()
  })

  it('isExpiredDemoUser は期限切れのデモ利用者だけ true', async () => {
    const expired = await insertDemo(new Date(Date.now() - HOUR))
    const active = await insertDemo(new Date(Date.now() + HOUR))
    const now = new Date()
    expect(await isExpiredDemoUser(env.DB, expired.partnerUserId, now)).toBe(true)
    expect(await isExpiredDemoUser(env.DB, active.partnerUserId, now)).toBe(false)
    expect(await isExpiredDemoUser(env.DB, await insertUser('normal'), now)).toBe(false)
  })
})
