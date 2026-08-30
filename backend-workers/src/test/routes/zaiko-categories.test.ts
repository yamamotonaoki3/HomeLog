import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shopping_list_items'),
    env.DB.prepare('DELETE FROM inventory_items'),
    env.DB.prepare('DELETE FROM stores'),
    env.DB.prepare('DELETE FROM zaiko_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ userId: number; headers: Record<string, string> }> {
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
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

beforeEach(async () => {
  await resetDb()
})

describe('GET /api/zaiko-categories', () => {
  it('初回アクセス時にデフォルト10カテゴリーを遅延シードして返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/zaiko-categories', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ id: number; name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(10)
    expect(body.every((c) => c.isDefault)).toBe(true)
    expect(body.map((c) => c.name)).toContain('野菜')
  })

  it('2回目以降はシードし直さない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    await app.request('/api/zaiko-categories', { headers }, env)

    const res = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await res.json<unknown[]>()
    expect(body).toHaveLength(10)
  })

  it('同時に複数リクエストが初回GETしても、デフォルトカテゴリーは重複シードされない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/zaiko-categories', { headers }, env)),
    )
    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    const finalRes = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await finalRes.json<unknown[]>()
    expect(body).toHaveLength(10)
  })

  it('GETより先にPOSTでカスタムカテゴリーを作っても、後のGETでデフォルト10件がシードされる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    await app.request(
      '/api/zaiko-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'お菓子' }) },
      env,
    )

    const res = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await res.json<{ name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(11)
    expect(body.filter((c) => c.isDefault)).toHaveLength(10)
    expect(body.some((c) => c.name === 'お菓子' && !c.isDefault)).toBe(true)
  })
})

describe('POST /api/zaiko-categories', () => {
  it('201でカテゴリーを追加できる(isDefault=false)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ name: string; isDefault: boolean }>()
    expect(body.name).toBe('お菓子')
    expect(body.isDefault).toBe(false)
  })
})

describe('PATCH /api/zaiko-categories/:id', () => {
  it('デフォルトカテゴリーは編集できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const listRes = await app.request('/api/zaiko-categories', { headers }, env)
    const [defaultCategory] = await listRes.json<{ id: number }[]>()

    const res = await app.request(
      `/api/zaiko-categories/${defaultCategory.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '変更後' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('カスタムカテゴリーは編集できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/zaiko-categories/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'スイーツ' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string }>()
    expect(body.name).toBe('スイーツ')
  })

  it('他世帯のカテゴリーを指定すると404を返す', async () => {
    const other = await createUserWithHousehold('hanako@example.com')
    const otherListRes = await app.request('/api/zaiko-categories', { headers: other.headers }, env)
    const [otherCategory] = await otherListRes.json<{ id: number }[]>()

    const { headers } = await createUserWithHousehold('taro@example.com')
    const res = await app.request(
      `/api/zaiko-categories/${otherCategory.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '変更後' }),
      },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/zaiko-categories/:id', () => {
  it('使用中のカテゴリーは削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const listRes = await app.request('/api/zaiko-categories', { headers }, env)
    const [category] = await listRes.json<{ id: number }[]>()
    await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId: category.id, storeId: null, quantity: 1, threshold: 0.5 }),
      },
      env,
    )

    const res = await app.request(`/api/zaiko-categories/${category.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('未使用のカスタムカテゴリーは削除できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/zaiko-categories/${created.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(204)
  })
})
