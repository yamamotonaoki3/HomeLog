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

async function createCategory(headers: Record<string, string>): Promise<number> {
  const res = await app.request(
    '/api/zaiko-categories',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'カテゴリA' }) },
    env,
  )
  const body = await res.json<{ id: number }>()
  return body.id
}

beforeEach(async () => {
  await resetDb()
})

describe('店舗マスタ', () => {
  it('GET は空配列を返し、POSTで201追加できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const emptyRes = await app.request('/api/stores', { headers }, env)
    expect(await emptyRes.json()).toEqual([])

    const createRes = await app.request(
      '/api/stores',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'スーパーA' }) },
      env,
    )
    expect(createRes.status).toBe(201)
    const created = await createRes.json<{ id: number; name: string }>()
    expect(created.name).toBe('スーパーA')

    const listRes = await app.request('/api/stores', { headers }, env)
    expect(await listRes.json()).toEqual([{ id: created.id, name: 'スーパーA' }])
  })

  it('PATCHで名前を編集できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/stores',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'スーパーA' }) },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/stores/${created.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'スーパーB' }) },
      env,
    )

    expect(res.status).toBe(200)
    expect((await res.json<{ name: string }>()).name).toBe('スーパーB')
  })

  it('使用中の店舗は削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const storeRes = await app.request(
      '/api/stores',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'スーパーA' }) },
      env,
    )
    const store = await storeRes.json<{ id: number }>()
    await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: store.id, quantity: 1, threshold: 0.5 }),
      },
      env,
    )

    const res = await app.request(`/api/stores/${store.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('未使用の店舗は削除でき204を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/stores',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'スーパーA' }) },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/stores/${created.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(204)
  })

  it('他世帯の店舗を指定すると404を返す', async () => {
    const other = await createUserWithHousehold('hanako@example.com')
    const otherStoreRes = await app.request(
      '/api/stores',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ name: '他世帯の店' }) },
      env,
    )
    const otherStore = await otherStoreRes.json<{ id: number }>()

    const { headers } = await createUserWithHousehold('taro@example.com')
    const res = await app.request(`/api/stores/${otherStore.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(404)
  })
})
