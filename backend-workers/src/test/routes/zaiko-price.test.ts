import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'

let headers: Record<string, string>
let categoryId: number
let householdId: number
const base = () => ({ name: '[E2E_TEST] testuser_item', categoryId, storeId: null, quantity: 2, threshold: 1 })
const call = (path: string, method = 'GET', body?: unknown, auth = headers) =>
  app.request(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
const inventory = async () => (await call('inventory-items')).json<{ id: number; price: number | null; quantity: number }[]>()
const shopping = async () => (await call('shopping-list-items')).json<{ id: number; inventoryItemId: number; price: number | null }[]>()
async function create(price: unknown = undefined, extra = {}) {
  const response = await call('inventory-items', 'POST', { ...base(), ...extra, ...(price === undefined ? {} : { price }) })
  expect(response.status).toBe(201)
  return response.json<{ id: number; price: number | null }>()
}

beforeEach(async () => {
  await env.DB.batch(['shopping_list_items', 'inventory_items', 'stores', 'zaiko_categories', 'household_members', 'households', 'users'].map(table => env.DB.prepare(`DELETE FROM ${table}`)))
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id').bind('testuser_price@example.com', 'dummy', 'testuser_price').first<{ id: number }>()
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id').bind('[E2E_TEST] household', 'PRICE00000000001').first<{ id: number }>()
  householdId = household!.id
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(householdId, user!.id).run()
  headers = { Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 900)}` }
  categoryId = (await (await call('zaiko-categories', 'POST', { name: '[E2E_TEST] category' })).json<{ id: number }>()).id
})

describe('在庫ID単位の参考値段', () => {
  it('既存D1行へマイグレーションを適用してNULLを追加し、数量とリスト参照を維持する', async () => {
    // このテスト専用DBを旧スキーマに戻して既存行を用意し、実際の移行SQLを適用する。
    await env.DB.prepare('ALTER TABLE inventory_items DROP COLUMN price').run()
    const item = await env.DB.prepare('INSERT INTO inventory_items (household_id, name, category_id, store_id, quantity_tenths, threshold_tenths) VALUES (?, ?, ?, NULL, 5, 10) RETURNING id')
      .bind(householdId, '[E2E_TEST] old item', categoryId).first<{ id: number }>()
    await env.DB.prepare('INSERT INTO shopping_list_items (household_id, inventory_item_id, is_manual) VALUES (?, ?, 0)').bind(householdId, item!.id).run()
    const migration = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS.find(m => m.name === '0014_inventory_item_price.sql')!
    await env.DB.batch(migration.queries.map(query => env.DB.prepare(query)))
    expect(await env.DB.prepare('SELECT price, quantity_tenths, threshold_tenths FROM inventory_items WHERE id = ?').bind(item!.id).first()).toEqual({ price: null, quantity_tenths: 5, threshold_tenths: 10 })
    expect((await shopping())[0]).toMatchObject({ inventoryItemId: item!.id, price: null })
  })
  it.each([undefined, null, 0, 1280, 9999999999])('登録・再取得でprice=%sを保持する', async price => {
    const item = await create(price)
    expect(item.price).toBe(price ?? null)
    expect((await inventory())[0].price).toBe(price ?? null)
  })
  it('PATCHで上書き・省略維持・nullクリアを行い、同名の別IDは変えない', async () => {
    const item = await create(1280)
    await create(300)
    for (const [input, expected] of [[{ price: 980 }, 980], [{}, 980], [{ price: null }, null]] as const) {
      const response = await call(`inventory-items/${item.id}`, 'PATCH', { ...base(), ...input })
      expect(response.status).toBe(200)
      expect((await response.json<{ price: number | null }>()).price).toBe(expected)
      expect((await inventory()).find(row => row.id === item.id)!.price).toBe(expected)
    }
    expect((await inventory()).find(row => row.id !== item.id)!.price).toBe(300)
  })
  it.each([-1, 0.1, '100', 10000000000, true])('不正なprice=%sは全書込経路で400、DB不変', async price => {
    const item = await create(1280)
    expect((await call('inventory-items', 'POST', { ...base(), price })).status).toBe(400)
    expect((await call(`inventory-items/${item.id}`, 'PATCH', { ...base(), price })).status).toBe(400)
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price })).status).toBe(400)
    expect(await inventory()).toHaveLength(1)
    expect((await inventory())[0].price).toBe(1280)
    expect(await shopping()).toEqual([])
  })
  it.each([undefined, null, 0, 980, 9999999999])('手動追加price=%sを共通在庫に反映する', async price => {
    const item = await create(1280)
    const response = await call('shopping-list-items', 'POST', { inventoryItemId: item.id, ...(price === undefined ? {} : { price }) })
    expect(response.status).toBe(201)
    const expected = price === undefined ? 1280 : price
    expect((await response.json<{ price: number | null }>()).price).toBe(expected)
    expect((await inventory())[0].price).toBe(expected)
    expect((await shopping())[0].price).toBe(expected)
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 1 })).status).toBe(400)
    expect((await inventory())[0].price).toBe(expected)
  })
  it('自動追加・掲載中の編集・購入除外・数量減算で値段を共有・保持する', async () => {
    const item = await create(1280, { quantity: 0 })
    expect((await shopping())[0].price).toBe(1280)
    await call(`inventory-items/${item.id}`, 'PATCH', { ...base(), price: 980 })
    expect((await shopping())[0].price).toBe(980)
    const entry = (await shopping())[0]
    expect((await call('shopping-list-items/update', 'POST', { items: [{ id: entry.id, purchasedQuantity: 2 }] })).status).toBe(200)
    expect(await shopping()).toEqual([])
    expect((await inventory())[0]).toMatchObject({ price: 980, quantity: 2 })
    await call(`inventory-items/${item.id}/quantity`, 'PATCH', { delta: -2 })
    expect((await shopping())[0].price).toBe(980)
    await call(`shopping-list-items/${(await shopping())[0].id}`, 'DELETE')
    await call('shopping-list-items', 'POST', { inventoryItemId: item.id })
    expect((await shopping())[0].price).toBe(980)
  })
  it('閾値を超えて自動リストを除外した後、再追加しても値段を保持する', async () => {
    const item = await create(1280, { quantity: 0 })
    expect((await shopping())[0].price).toBe(1280)
    expect((await call(`inventory-items/${item.id}/quantity`, 'PATCH', { delta: 2 })).status).toBe(200)
    expect(await shopping()).toEqual([])
    expect((await inventory())[0]).toMatchObject({ quantity: 2, price: 1280 })
    expect((await call(`inventory-items/${item.id}/quantity`, 'PATCH', { delta: -2 })).status).toBe(200)
    expect((await shopping())[0]).toMatchObject({ inventoryItemId: item.id, price: 1280 })
  })
  it('競合する手動追加は成功した1件のpriceだけを反映する', async () => {
    const item = await create(1280)
    const results = await Promise.all([980, 500].map(price => call('shopping-list-items', 'POST', { inventoryItemId: item.id, price })))
    expect(results.map(r => r.status).sort()).toEqual([201, 400])
    const winner = await results.find(r => r.status === 201)!.json<{ price: number }>()
    expect(await shopping()).toHaveLength(1)
    expect((await inventory())[0].price).toBe(winner.price)
  })
  it('INSERT失敗時は値段更新もロールバックする', async () => {
    const item = await create(1280)
    await env.DB.prepare("CREATE TRIGGER reject_price_insert BEFORE INSERT ON shopping_list_items BEGIN SELECT RAISE(ABORT, 'test insert failure'); END").run()
    try {
      expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 980 })).status).toBe(500)
      expect((await inventory())[0].price).toBe(1280)
      expect(await shopping()).toEqual([])
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_price_insert').run()
    }
  })
  it('事前確認後のUNIQUE競合は400となり、勝者の値段とリストを維持する', async () => {
    const item = await create(1280)
    const batch = env.DB.batch.bind(env.DB)
    // 事前SELECTを通過した後に別リクエストが追加した状況を実D1で確定させる。
    const competingInsert = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
      await batch([
        env.DB.prepare('INSERT INTO shopping_list_items (household_id, inventory_item_id, is_manual) VALUES (?, ?, 1)').bind(householdId, item.id),
        env.DB.prepare('UPDATE inventory_items SET price = 500 WHERE id = ?').bind(item.id),
      ])
      return batch(statements)
    })
    try {
      const response = await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 980 })
      expect(response.status).toBe(400)
      expect(competingInsert).toHaveBeenCalledOnce()
      expect(await shopping()).toHaveLength(1)
      expect((await shopping())[0]).toMatchObject({ inventoryItemId: item.id, price: 500 })
      expect((await inventory())[0].price).toBe(500)
    } finally {
      competingInsert.mockRestore()
    }
  })
  it('値段UPDATE失敗時は先行したリストINSERTもロールバックする', async () => {
    const item = await create(1280)
    await env.DB.prepare("CREATE TRIGGER reject_price_update BEFORE UPDATE OF price ON inventory_items BEGIN SELECT RAISE(ABORT, 'test update failure'); END").run()
    try {
      expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 980 })).status).toBe(500)
      expect((await inventory())[0].price).toBe(1280)
      expect(await shopping()).toEqual([])
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_price_update').run()
    }
  })
  it.each([
    ['inventory-items', 'POST', (): unknown => ({ ...base(), price: 980 })],
    ['inventory-items/1', 'PATCH', (): unknown => ({ ...base(), price: 980 })],
    ['shopping-list-items', 'GET', (): unknown => undefined],
  ] as const)('未認証の%s %sは401で値段とリストを変更しない', async (path, method, body) => {
    await create(1280)
    expect((await call(path, method, body(), {})).status).toBe(401)
    expect((await inventory())[0].price).toBe(1280)
    expect(await shopping()).toEqual([])
  })
  it('未認証・他世帯を拒否し、同世帯メンバーは編集できる', async () => {
    const item = await create(1280)
    expect((await call('inventory-items', 'GET', undefined, {})).status).toBe(401)
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 1 }, {})).status).toBe(401)
    const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id').bind('testuser_member@example.com', 'dummy', 'testuser_member').first<{ id: number }>()
    const member = { Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 900)}` }
    const other = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id').bind('[E2E_TEST] other', 'PRICE00000000002').first<{ id: number }>()
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(other!.id, user!.id).run()
    const otherCategoryResponse = await call('zaiko-categories', 'POST', { name: '[E2E_TEST] other category' }, member)
    expect(otherCategoryResponse.status).toBe(201)
    const otherCategory = await otherCategoryResponse.json<{ id: number }>()
    const otherItemResponse = await call('inventory-items', 'POST', { ...base(), categoryId: otherCategory.id, price: 500 }, member)
    expect(otherItemResponse.status).toBe(201)
    const otherItem = await otherItemResponse.json<{ id: number }>()
    expect((await call(`inventory-items/${item.id}`, 'PATCH', { ...base(), price: 1 }, member)).status).toBe(404)
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id, price: 1 }, member)).status).toBe(400)
    expect(await (await call('inventory-items', 'GET', undefined, member)).json()).toMatchObject([{ id: otherItem.id, price: 500 }])
    expect((await call(`inventory-items/${otherItem.id}`, 'PATCH', { ...base(), price: 1 })).status).toBe(404)
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: otherItem.id, price: 1 })).status).toBe(400)
    expect((await inventory())[0].price).toBe(1280)
    await env.DB.prepare('UPDATE household_members SET household_id = ? WHERE user_id = ?').bind(householdId, user!.id).run()
    expect((await call(`inventory-items/${item.id}`, 'PATCH', { ...base(), price: 980 }, member)).status).toBe(200)
    expect((await inventory())[0].price).toBe(980)
    expect(await (await call('inventory-items', 'GET', undefined, member)).json()).toEqual(await inventory())
    expect((await call('shopping-list-items', 'POST', { inventoryItemId: item.id }, member)).status).toBe(201)
    expect(await (await call('shopping-list-items', 'GET', undefined, member)).json()).toEqual(await shopping())
    expect(await env.DB.prepare('SELECT price FROM inventory_items WHERE id = ?').bind(otherItem.id).first()).toEqual({ price: 500 })
  })
})
