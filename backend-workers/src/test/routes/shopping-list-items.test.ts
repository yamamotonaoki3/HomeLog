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
): Promise<{ id: number }> {
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

describe('GET /api/shopping-list-items', () => {
  it('名前順で取得できる(sort未指定時のデフォルト)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    await createItem(headers, { name: 'にんじん', categoryId, storeId: null, quantity: 0, threshold: 1 })
    await createItem(headers, { name: 'あいすくりーむ', categoryId, storeId: null, quantity: 0, threshold: 1 })

    const res = await app.request('/api/shopping-list-items', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string }[]>()
    expect(body.map((i) => i.name)).toEqual(['あいすくりーむ', 'にんじん'])
  })
})

describe('POST /api/shopping-list-items', () => {
  it('手動で追加でき、isManual=trueになる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 5, threshold: 0.5 })

    const res = await app.request(
      '/api/shopping-list-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ inventoryItemId: item.id }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ isManual: boolean; purchased: boolean; purchasedQuantity: number }>()
    expect(body.isManual).toBe(true)
    expect(body.purchased).toBe(false)
    expect(body.purchasedQuantity).toBe(0)
  })

  it('既に追加済みの場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0.2, threshold: 0.5 })

    const res = await app.request(
      '/api/shopping-list-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ inventoryItemId: item.id }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/shopping-list-items/:id', () => {
  it('削除できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 5, threshold: 0.5 })
    const addRes = await app.request(
      '/api/shopping-list-items',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inventoryItemId: item.id }) },
      env,
    )
    const added = await addRes.json<{ id: number }>()

    const res = await app.request(`/api/shopping-list-items/${added.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(204)
  })
})

describe('POST /api/shopping-list-items/update', () => {
  it('手動追加分は購入処理で無条件に削除される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 5, threshold: 0.5 })
    const addRes = await app.request(
      '/api/shopping-list-items',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inventoryItemId: item.id }) },
      env,
    )
    const added = await addRes.json<{ id: number }>()

    const res = await app.request(
      '/api/shopping-list-items/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ items: [{ id: added.id, purchasedQuantity: 2 }] }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{
      updatedInventoryItems: { id: number; quantity: number }[]
      removedShoppingListItemIds: number[]
    }>()
    expect(body.updatedInventoryItems).toEqual([{ id: item.id, quantity: 7 }])
    expect(body.removedShoppingListItemIds).toEqual([added.id])

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    expect(await listRes.json()).toEqual([])
  })

  it('自動追加分は購入後も閾値未満なら削除されずリセットされる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    // quantity=0, threshold=10 → 自動追加される。購入個数1個追加してもまだ閾値未満のまま。
    await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0, threshold: 10 })

    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const [autoEntry] = await listRes.json<{ id: number }[]>()

    const res = await app.request(
      '/api/shopping-list-items/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ items: [{ id: autoEntry.id, purchasedQuantity: 1 }] }),
      },
      env,
    )

    const body = await res.json<{ removedShoppingListItemIds: number[] }>()
    expect(body.removedShoppingListItemIds).toEqual([])

    const afterListRes = await app.request('/api/shopping-list-items', { headers }, env)
    const [afterEntry] = await afterListRes.json<{ id: number; purchased: boolean; purchasedQuantity: number }[]>()
    expect(afterEntry.id).toBe(autoEntry.id)
    expect(afterEntry.purchased).toBe(false)
    expect(afterEntry.purchasedQuantity).toBe(0)

    const itemRes = await app.request('/api/inventory-items', { headers }, env)
    const [updatedItem] = await itemRes.json<{ id: number; quantity: number }[]>()
    expect(updatedItem.quantity).toBe(1)
  })

  it('自動追加分でも購入後に閾値を上回れば削除される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity: 0, threshold: 0.5 })
    const listRes = await app.request('/api/shopping-list-items', { headers }, env)
    const [autoEntry] = await listRes.json<{ id: number }[]>()

    const res = await app.request(
      '/api/shopping-list-items/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ items: [{ id: autoEntry.id, purchasedQuantity: 2 }] }),
      },
      env,
    )

    const body = await res.json<{ removedShoppingListItemIds: number[] }>()
    expect(body.removedShoppingListItemIds).toEqual([autoEntry.id])
  })
})
