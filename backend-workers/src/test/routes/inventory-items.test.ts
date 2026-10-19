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

  it.each([
    [0.5, 0.5, true],
    [0.6, 0.5, false],
    [0, 0, true],
  ])('登録時に数量%sと閾値%sで、閾値以下なら自動追加される(%s) (#314)', async (quantity, threshold, added) => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '牛乳', categoryId, storeId: null, quantity, threshold })
    const list = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ inventoryItemId: number }[]>()
    expect(list.some((i) => i.inventoryItemId === item.id)).toBe(added)
  })

  it('減算で閾値ちょうどになると自動追加され、加算で閾値を超えると除外される (#314)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const item = await createItem(headers, { name: '卵', categoryId, storeId: null, quantity: 4, threshold: 3 })
    const change = (delta: number) => app.request(`/api/inventory-items/${item.id}/quantity`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ delta }),
    }, env)
    const listed = async () => (await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ inventoryItemId: number }[]>()).some((i) => i.inventoryItemId === item.id)
    await change(-1)
    expect(await listed()).toBe(true)
    await change(1)
    expect(await listed()).toBe(false)
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

describe('在庫品名の重複 (#318)', () => {
  const request = (headers: Record<string, string>, body: Record<string, unknown>, id?: number) => app.request(
    id === undefined ? '/api/inventory-items' : `/api/inventory-items/${id}`,
    { method: id === undefined ? 'POST' : 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env,
  )

  it('正規化後に同じ品名を同時登録すると201と409になり、DBには1件だけ残る', async () => {
    const { headers } = await createUserWithHousehold('testuser_normalized_post@example.com')
    const categoryId = await createCategory(headers)
    const names = ['[E2E_TEST] Milk', '[E2E_TEST] ＭＩＬＫ']
    const responses = await Promise.all(names.map((name) => request(headers, {
      name, categoryId, storeId: null, quantity: 1, threshold: 0,
    })))
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409])
    const rows = await env.DB.prepare('SELECT name, normalized_name FROM inventory_items')
      .all<{ name: string; normalized_name: string }>()
    expect(rows.results).toHaveLength(1)
    expect(names).toContain(rows.results[0].name)
    expect(rows.results[0].normalized_name).toBe('[e2e_test] milk')
  })

  it('別の在庫を正規化後に同じ品名へ同時編集すると200と409になり、変更されるのは1件だけ', async () => {
    const { headers } = await createUserWithHousehold('testuser_normalized_patch@example.com')
    const categoryId = await createCategory(headers)
    const body = { categoryId, storeId: null, quantity: 1, threshold: 0 }
    const originals = ['[E2E_TEST] 元の品名A', '[E2E_TEST] 元の品名B']
    const items: { id: number }[] = []
    for (const name of originals) {
      items.push(await createItem(headers, { ...body, name }))
    }
    const names = ['[E2E_TEST] Milk', '[E2E_TEST] ＭＩＬＫ']
    const responses = await Promise.all(items.map((item, index) =>
      request(headers, { ...body, name: names[index] }, item.id)))
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409])
    const rows = await env.DB.prepare('SELECT id, name, normalized_name FROM inventory_items')
      .all<{ id: number; name: string; normalized_name: string }>()
    expect(rows.results).toHaveLength(2)
    expect(rows.results.filter((row) => row.normalized_name === '[e2e_test] milk')).toHaveLength(1)
    for (const [index, res] of responses.entries()) {
      const row = rows.results.find((row) => row.id === items[index].id)!
      expect(row.name).toBe(res.status === 200 ? names[index] : originals[index])
    }
  })

  it('同じ品名を同時登録すると201と409になり、在庫と買い物リストは1件だけ残る', async () => {
    const { headers } = await createUserWithHousehold('testuser_concurrent@example.com')
    const categoryId = await createCategory(headers)
    const body = { name: ' [E2E_TEST] 牛乳 ', categoryId, storeId: null, quantity: 0, threshold: 1 }
    const responses = await Promise.all([request(headers, body), request(headers, body)])
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409])
    expect(await responses.find((res) => res.status === 409)!.json()).toMatchObject({ code: 'DUPLICATE_INVENTORY_ITEM_NAME' })
    const rows = await env.DB.prepare('SELECT name FROM inventory_items').all<{ name: string }>()
    expect(rows.results).toEqual([{ name: body.name.trim() }])
    const shopping = await env.DB.prepare('SELECT COUNT(*) AS count FROM shopping_list_items').first<{ count: number }>()
    expect(shopping?.count).toBe(1)
  })

  it.each(['MILK', 'milk', 'ＭＩＬＫ', '　 milk \t', 'ﾐﾙｸ'])('登録・編集で正規化した品名の重複を拒否する: %s', async (name) => {
    const { headers } = await createUserWithHousehold('testuser_duplicate@example.com')
    const categoryId = await createCategory(headers)
    const body = { name: name === 'ﾐﾙｸ' ? 'ミルク' : 'Milk', categoryId, storeId: null, quantity: 1, threshold: 0 }
    expect((await request(headers, body)).status).toBe(201)
    const other = await request(headers, { ...body, name: '[E2E_TEST] 別品' })
    const { id } = await other.json<{ id: number }>()
    for (const itemId of [undefined, id]) {
      const res = await request(headers, { ...body, name }, itemId)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ code: 'DUPLICATE_INVENTORY_ITEM_NAME', message: '同じ品名の在庫が既に登録されています', details: [] })
    }
    const listed = await (await app.request('/api/inventory-items', { headers }, env)).json<{ name: string }[]>()
    expect(listed.map((item) => item.name)).toEqual([body.name, '[E2E_TEST] 別品'])
  })

  it('自己除外と別世帯の同名登録を許可する', async () => {
    for (const email of ['testuser_one@example.com', 'testuser_two@example.com']) {
      const { headers } = await createUserWithHousehold(email)
      const categoryId = await createCategory(headers)
      const body = { name: 'Milk', categoryId, storeId: null, quantity: 1, threshold: 0 }
      const created = await request(headers, body)
      expect(created.status).toBe(201)
      const { id } = await created.json<{ id: number }>()
      expect((await request(headers, body, id)).status).toBe(200)
      expect((await request(headers, { ...body, name: ' ＭＩＬＫ ' }, id)).status).toBe(200)
    }
  })
})
