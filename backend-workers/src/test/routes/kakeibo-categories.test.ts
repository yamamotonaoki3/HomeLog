import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `CODE${user.id}00000000000`.slice(0, 16))
    .first<{ id: number }>()
  if (!household) throw new Error('test setup error')
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)')
    .bind(household.id, user.id)
    .run()
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { headers: { Authorization: `Bearer ${token}` } }
}

beforeEach(async () => {
  await resetDb()
})

describe('GET /api/kakeibo-categories', () => {
  it('初回アクセス時にデフォルト11カテゴリーを遅延シードして返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/kakeibo-categories', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(11)
    expect(body.every((c) => c.isDefault)).toBe(true)
    expect(body.map((c) => c.name)).toContain('食費')
    expect(body.map((c) => c.name)).toContain('割り勘精算')
  })

  it('同時に複数リクエストが初回GETしても重複シードされない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    await Promise.all(Array.from({ length: 5 }, () => app.request('/api/kakeibo-categories', { headers }, env)))

    const res = await app.request('/api/kakeibo-categories', { headers }, env)
    expect(await res.json<unknown[]>()).toHaveLength(11)
  })
})

describe('POST /api/kakeibo-categories', () => {
  it('201でカテゴリーを追加できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/kakeibo-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '娯楽費' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ name: string; isDefault: boolean }>()
    expect(body.name).toBe('娯楽費')
    expect(body.isDefault).toBe(false)
  })
})

describe('PATCH/DELETE /api/kakeibo-categories/:id', () => {
  it('デフォルトカテゴリーは編集も削除もできず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const listRes = await app.request('/api/kakeibo-categories', { headers }, env)
    const [defaultCategory] = await listRes.json<{ id: number }[]>()

    const patchRes = await app.request(
      `/api/kakeibo-categories/${defaultCategory.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '変更後' }) },
      env,
    )
    expect(patchRes.status).toBe(400)

    const deleteRes = await app.request(`/api/kakeibo-categories/${defaultCategory.id}`, { method: 'DELETE', headers }, env)
    expect(deleteRes.status).toBe(400)
  })

  it('使用中のカスタムカテゴリーは削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/kakeibo-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '娯楽費' }) },
      env,
    )
    const category = await createRes.json<{ id: number }>()
    await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 1000, purpose: '映画', categoryId: category.id }),
      },
      env,
    )

    const res = await app.request(`/api/kakeibo-categories/${category.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })
})
