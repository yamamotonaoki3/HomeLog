import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'
import { consumeInventoryForDate } from '../../lib/inventory-consumption'

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

function beforePurchaseBatch(action: () => Promise<void>) {
  let fired = false
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        if (!fired) {
          fired = true
          await action()
        }
        return target.batch(statements)
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { bindings: { ...env, DB }, wasTriggered: () => fired }
}

describe('一括購入の競合 (#394)', () => {
  it('複数の手動・自動品目と数量0も全件反映し、要求順の確定結果を返す', async () => {
    const { headers } = await createUserWithHousehold('testuser_purchase_mixed@example.com')
    const categoryId = await createCategory(headers)
    const items: { id: number }[] = []
    for (let i = 0; i < 3; i++) {
      items.push(await createItem(headers, { name: `[E2E_TEST] mixed ${i}`, categoryId, storeId: null, quantity: 0, threshold: [0, 2, 5][i] }))
    }
    const manual = await createItem(headers, { name: '[E2E_TEST] manual zero', categoryId, storeId: null, quantity: 10, threshold: 0 })
    expect((await app.request('/api/shopping-list-items', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ inventoryItemId: manual.id }) }, env)).status).toBe(201)
    const entries = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number; inventoryItemId: number }[]>()
    const entryId = (itemId: number) => entries.find((entry) => entry.inventoryItemId === itemId)!.id
    const response = await app.request('/api/shopping-list-items/update', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [
        { id: entryId(manual.id), purchasedQuantity: 0 }, { id: entryId(items[2].id), purchasedQuantity: 1 },
        { id: entryId(items[0].id), purchasedQuantity: 1 }, { id: entryId(items[1].id), purchasedQuantity: 2 },
      ] }),
    }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      updatedInventoryItems: [{ id: manual.id, quantity: 10 }, { id: items[2].id, quantity: 1 }, { id: items[0].id, quantity: 1 }, { id: items[1].id, quantity: 2 }],
      removedShoppingListItemIds: [entryId(manual.id), entryId(items[0].id)],
    })
    expect((await env.DB.prepare('SELECT inventory_item_id, purchased, purchased_quantity_tenths, purchase_revision FROM shopping_list_items ORDER BY inventory_item_id').all()).results).toEqual([
      { inventory_item_id: items[1].id, purchased: 0, purchased_quantity_tenths: 0, purchase_revision: 1 },
      { inventory_item_id: items[2].id, purchased: 0, purchased_quantity_tenths: 0, purchase_revision: 1 },
    ])
  })

  it('在庫加算後の入力リセットでDBエラーが起きても在庫を含め全件ロールバックする', async () => {
    const { headers } = await createUserWithHousehold('testuser_purchase_rollback@example.com')
    const categoryId = await createCategory(headers)
    for (let i = 0; i < 3; i++) {
      await createItem(headers, { name: `[E2E_TEST] rollback ${i}`, categoryId, storeId: null, quantity: 0, threshold: 100 })
    }
    const snapshot = async () => (await env.DB.prepare('SELECT id, quantity_tenths FROM inventory_items ORDER BY id').all()).results
    const before = await snapshot()
    const entries = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number }[]>()
    await env.DB.exec("CREATE TRIGGER test_purchase_abort BEFORE UPDATE OF purchased ON shopping_list_items BEGIN SELECT RAISE(ABORT, 'test_purchase_abort'); END;")
    try {
      const response = await app.request('/api/shopping-list-items/update', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: entries.map((entry) => ({ id: entry.id, purchasedQuantity: 1 })) }),
      }, env)
      expect(response.status).toBe(500)
      expect(await snapshot()).toEqual(before)
      expect((await env.DB.prepare('SELECT purchase_revision FROM shopping_list_items').all()).results).toEqual(Array.from({ length: 3 }, () => ({ purchase_revision: 0 })))
    } finally {
      await env.DB.exec('DROP TRIGGER test_purchase_abort;')
    }
  })

  it('先に日次消費が確定しても数量の変化だけでは競合とせず、全件に購入を加算する', async () => {
    const { headers } = await createUserWithHousehold('testuser_purchase_cron@example.com')
    const categoryId = await createCategory(headers)
    for (let i = 0; i < 3; i++) {
      const item = await createItem(headers, { name: `[E2E_TEST] cron ${i}`, categoryId, storeId: null, quantity: 10, threshold: 0, dailyConsumption: 1, autoConsumptionEnabled: true })
      expect((await app.request('/api/shopping-list-items', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ inventoryItemId: item.id }) }, env)).status).toBe(201)
    }
    await env.DB.prepare("UPDATE inventory_items SET last_consumed_on = '2099-01-01'").run()
    const entries = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number }[]>()
    const race = beforePurchaseBatch(() => consumeInventoryForDate(env.DB, '2099-01-02'))
    const response = await app.request('/api/shopping-list-items/update', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: entries.map((entry) => ({ id: entry.id, purchasedQuantity: 1 })) }),
    }, race.bindings)
    expect(race.wasTriggered()).toBe(true)
    expect(response.status).toBe(200)
    expect((await env.DB.prepare('SELECT quantity_tenths FROM inventory_items').all()).results).toEqual(Array.from({ length: 3 }, () => ({ quantity_tenths: 100 })))
    expect((await env.DB.prepare('SELECT id FROM shopping_list_items').all()).results).toHaveLength(0)
  })

  const cases = ['list-delete', 'inventory-delete', 'limit'].flatMap((kind) => [0, 1, 2].map((index) => ({ kind, index })))
  it.each(cases)('$kind が位置$indexで競合したら購入を全件未反映にする', async ({ kind, index }) => {
    const { headers } = await createUserWithHousehold('testuser_purchase_race@example.com')
    const categoryId = await createCategory(headers)
    const items: { id: number; entryId: number }[] = []
    for (let i = 0; i < 3; i++) {
      const item = await createItem(headers, { name: `[E2E_TEST] item ${i}`, categoryId, storeId: null, quantity: 10, threshold: 0 })
      const entry = await (await app.request('/api/shopping-list-items', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ inventoryItemId: item.id }) }, env)).json<{ id: number }>()
      items.push({ id: item.id, entryId: entry.id })
    }
    await env.DB.prepare('UPDATE shopping_list_items SET purchased = 1, purchased_quantity_tenths = 10').run()
    const snapshot = async () => ({
      inventory: (await env.DB.prepare('SELECT * FROM inventory_items ORDER BY id').all()).results,
      shopping: (await env.DB.prepare('SELECT * FROM shopping_list_items ORDER BY id').all()).results,
    })
    let before: Awaited<ReturnType<typeof snapshot>> | undefined
    const race = beforePurchaseBatch(async () => {
      const target = items[index]
      if (kind === 'limit') {
        const response = await app.request(`/api/inventory-items/${target.id}/quantity`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: 99989.9 }) }, env)
        expect(response.status).toBe(200)
      } else {
        const path = kind === 'list-delete' ? `/api/shopping-list-items/${target.entryId}` : `/api/inventory-items/${target.id}`
        expect((await app.request(path, { method: 'DELETE', headers }, env)).status).toBe(204)
      }
      before = await snapshot()
    })
    const response = await app.request('/api/shopping-list-items/update', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.map((item) => ({ id: item.entryId, purchasedQuantity: 1 })) }),
    }, race.bindings)
    expect(race.wasTriggered()).toBe(true)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RESOURCE_CONFLICT' })
    expect(await snapshot()).toEqual(before)
  })

  it('自動追加でリストに残る品目でも、同じ状態を読んだ購入同士は二重加算しない', async () => {
    const { headers } = await createUserWithHousehold('testuser_purchase_duplicate@example.com')
    const categoryId = await createCategory(headers)
    for (let i = 0; i < 3; i++) {
      await createItem(headers, { name: `[E2E_TEST] auto ${i}`, categoryId, storeId: null, quantity: 0, threshold: 100 })
    }
    const entries = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number }[]>()
    const body = JSON.stringify({ items: entries.map((entry) => ({ id: entry.id, purchasedQuantity: 1 })) })
    const request = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }
    const race = beforePurchaseBatch(async () => {
      expect((await app.request('/api/shopping-list-items/update', request, env)).status).toBe(200)
    })
    const response = await app.request('/api/shopping-list-items/update', request, race.bindings)
    expect(race.wasTriggered()).toBe(true)
    expect(response.status).toBe(409)
    expect((await env.DB.prepare('SELECT quantity_tenths FROM inventory_items ORDER BY id').all()).results).toEqual([{ quantity_tenths: 10 }, { quantity_tenths: 10 }, { quantity_tenths: 10 }])
    expect((await env.DB.prepare('SELECT purchased, purchased_quantity_tenths FROM shopping_list_items').all()).results).toEqual(Array.from({ length: 3 }, () => ({ purchased: 0, purchased_quantity_tenths: 0 })))
  })
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
  it('同じidを複数回指定した場合は400を返す', async () => {
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
        body: JSON.stringify({
          items: [
            { id: added.id, purchasedQuantity: 1 },
            { id: added.id, purchasedQuantity: 1 },
          ],
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

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

  it('自動追加分は購入後に閾値ちょうどなら削除されずリセットされる (#314)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    await createItem(headers, { name: '卵', categoryId, storeId: null, quantity: 1, threshold: 3 })
    const [autoEntry] = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number }[]>()
    const res = await app.request('/api/shopping-list-items/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ items: [{ id: autoEntry.id, purchasedQuantity: 2 }] }),
    }, env)
    expect((await res.json<{ removedShoppingListItemIds: number[] }>()).removedShoppingListItemIds).toEqual([])
    const [afterEntry] = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number; purchased: boolean }[]>()
    expect(afterEntry).toMatchObject({ id: autoEntry.id, purchased: false })
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

it('購入は自動消費設定・基準日・revisionを維持する (#329)', async () => {
  const { headers } = await createUserWithHousehold('testuser_consumption_purchase@example.com')
  const categoryId = await createCategory(headers)
  const item = await createItem(headers, { name: '[E2E_TEST] testuser_purchase', categoryId, storeId: null, quantity: 0, threshold: 1, dailyConsumption: 0.2 })
  const before = await env.DB.prepare('SELECT daily_consumption_tenths, auto_consumption_enabled, last_consumed_on, consumption_revision FROM inventory_items WHERE id = ?').bind(item.id).first()
  const [entry] = await (await app.request('/api/shopping-list-items', { headers }, env)).json<{ id: number }[]>()
  const res = await app.request('/api/shopping-list-items/update', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: entry.id, purchasedQuantity: 0.5 }] }) }, env)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ updatedInventoryItems: [{ id: item.id, quantity: 0.5 }], removedShoppingListItemIds: [] })
  expect(await env.DB.prepare('SELECT daily_consumption_tenths, auto_consumption_enabled, last_consumed_on, consumption_revision FROM inventory_items WHERE id = ?').bind(item.id).first()).toEqual(before)
})
