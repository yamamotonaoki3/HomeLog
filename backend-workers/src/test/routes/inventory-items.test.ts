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
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'カテゴリA' }),
    },
    env,
  )
  return (await res.json<{ id: number }>()).id
}

async function createItem(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ id: number; name: string; categoryId: number; storeId: number | null; quantity: number; threshold: number }> {
  const res = await app.request(
    '/api/inventory-items',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    env,
  )
  return res.json()
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/inventory-items', () => {
  it('201で在庫アイテムを登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)

    const res = await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: null, quantity: 1.5, threshold: 0.5 }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ quantity: number; threshold: number }>()
    expect(body.quantity).toBe(1.5)
    expect(body.threshold).toBe(0.5)
  })

  it('数量が0未満の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)

    const res = await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: null, quantity: -1, threshold: 0.5 }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('小数点第二位以下を含む場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)

    const res = await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: null, quantity: 1.23, threshold: 0.5 }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('存在しないcategoryIdの場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId: 99999, storeId: null, quantity: 1, threshold: 0.5 }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('登録時に数量が閾値未満なら買い物リストへ自動追加される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)

    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0.2, threshold: 0.5 })

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const list = await listRes.json<{ inventoryItemId: number; isManual: boolean }[]>()
    expect(list.some((i) => i.inventoryItemId === item.id && i.isManual === false)).toBe(true)
  })
})

describe('PATCH /api/inventory-items/:id', () => {
  it('編集でき、閾値を上回れば自動追加された買い物リスト項目が除外される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0.2, threshold: 0.5 })

    const res = await app.request(
      `/api/inventory-items/${item.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: null, threshold: 0.1 }),
      },
      env,
    )
    expect(res.status).toBe(200)

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const list = await listRes.json<{ inventoryItemId: number }[]>()
    expect(list.some((i) => i.inventoryItemId === item.id)).toBe(false)
  })

  it('他世帯のアイテムを指定すると404を返す', async () => {
    const other = await createUserWithHousehold('hanako@example.com')
    const otherCategoryId = await createCategory(other.headers)
    const otherItem = await createItem(other.headers, {
      name: '他世帯の牛乳',
      categoryId: otherCategoryId,
      storeId: null,
      quantity: 1,
      threshold: 0.5,
    })

    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const res = await app.request(
      `/api/inventory-items/${otherItem.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId, storeId: null, threshold: 0.1 }),
      },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('手動追加済みの項目と閾値による自動同期の相互作用', () => {
  it('手動追加済みの項目が閾値を下回っても、重複して自動追加されない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    // 閾値以上の数量で作成(自動追加されない状態)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 5, threshold: 0.5 })
    await app.request(
      '/api/shopping-list-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ inventoryItemId: item.id }),
      },
      env,
    )

    // 数量を閾値未満まで減らす → syncShoppingListが走るが、既に手動追加済みなので重複追加されないはず
    const res = await app.request(
      `/api/inventory-items/${item.id}/quantity`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ delta: -4.6 }),
      },
      env,
    )
    expect(res.status).toBe(200)

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const list = await listRes.json<{ inventoryItemId: number }[]>()
    expect(list.filter((i) => i.inventoryItemId === item.id)).toHaveLength(1)
  })
})

describe('PATCH /api/inventory-items/:id/quantity', () => {
  it('同時に複数回増減しても、片方の更新が失われない(条件付き相対UPDATEによる競合対策)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 5, threshold: 0.5 })

    await Promise.all(
      Array.from({ length: 5 }, () =>
        app.request(
          `/api/inventory-items/${item.id}/quantity`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ delta: 0.1 }),
          },
          env,
        ),
      ),
    )

    const listRes = await app.request('/api/inventory-items', { headers }, env)
    const [updatedItem] = await listRes.json<{ quantity: number }[]>()
    expect(updatedItem.quantity).toBe(5.5)
  })

  it('数量を増減できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 1, threshold: 0.5 })

    const res = await app.request(
      `/api/inventory-items/${item.id}/quantity`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ delta: -0.1 }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ quantity: number }>()
    expect(body.quantity).toBe(0.9)
  })

  it('0未満になる場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0.5, threshold: 0.5 })

    const res = await app.request(
      `/api/inventory-items/${item.id}/quantity`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ delta: -1 }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('減算により閾値を下回ると買い物リストへ自動追加される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 1, threshold: 0.5 })

    await app.request(
      `/api/inventory-items/${item.id}/quantity`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ delta: -0.6 }) },
      env,
    )

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const list = await listRes.json<{ inventoryItemId: number }[]>()
    expect(list.some((i) => i.inventoryItemId === item.id)).toBe(true)
  })
})

describe('DELETE /api/inventory-items/:id', () => {
  it('削除でき、紐づく買い物リスト項目も削除される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0.2, threshold: 0.5 })

    const res = await app.request(`/api/inventory-items/${item.id}`, { method: 'DELETE', headers }, env)
    expect(res.status).toBe(204)

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const list = await listRes.json<{ inventoryItemId: number }[]>()
    expect(list.some((i) => i.inventoryItemId === item.id)).toBe(false)
  })
})
