import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM incomes'),
    env.DB.prepare('DELETE FROM income_categories'),
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

describe('GET /api/income-categories', () => {
  it('初回アクセス時にデフォルト4カテゴリーを遅延シードして返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/income-categories', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(4)
    expect(body.map((c) => c.name).sort()).toEqual(['その他', 'ボーナス', '副業', '給与'].sort())
  })
})

describe('POST/PATCH/DELETE /api/income-categories', () => {
  it('追加・編集・削除ができる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const createRes = await app.request(
      '/api/income-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '配当金' }) },
      env,
    )
    expect(createRes.status).toBe(201)
    const created = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/income-categories/${created.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '株式配当' }) },
      env,
    )
    expect(patchRes.status).toBe(200)

    const deleteRes = await app.request(`/api/income-categories/${created.id}`, { method: 'DELETE', headers }, env)
    expect(deleteRes.status).toBe(204)
  })

  it('使用中のカスタムカテゴリーは削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/income-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '配当金' }) },
      env,
    )
    const category = await createRes.json<{ id: number }>()
    await app.request(
      '/api/incomes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ incomeDate: '2024-01-01', amount: 5000, content: '配当', categoryId: category.id }),
      },
      env,
    )

    const res = await app.request(`/api/income-categories/${category.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })
})
