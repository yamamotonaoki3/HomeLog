import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { consumeInventoryForDate, consumptionDate, latestConsumptionDate, consumptionStatements } from '../../lib/inventory-consumption'

let headers: Record<string, string>
let categoryId: number
let householdId: number
const base = () => ({ name: '[E2E_TEST] testuser_milk', categoryId, storeId: null, quantity: 2, threshold: 1 })
async function request(method: string, path: string, body?: unknown) {
  return app.request(`/api/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
}
async function create(extra: Record<string, unknown> = {}) {
  const res = await request('POST', 'inventory-items', { ...base(), ...extra })
  expect(res.status).toBe(201)
  return res.json<{ id: number; dailyConsumption: number | null; autoConsumptionEnabled: boolean }>()
}
async function row(id: number) {
  return env.DB.prepare('SELECT * FROM inventory_items WHERE id = ?').bind(id).first<{
    quantity_tenths: number; last_consumed_on: string | null; consumption_revision: number;
    auto_consumption_enabled: number; daily_consumption_tenths: number | null
  }>()
}
async function anchor(id: number, date = '2024-02-28') {
  await env.DB.prepare('UPDATE inventory_items SET last_consumed_on = ? WHERE id = ?').bind(date, id).run()
}
beforeEach(async () => {
  // Stable creation clock; extended test-only token lifetime permits multi-day clock jumps.
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-28T02:00:00Z'))
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(`testuser_${crypto.randomUUID()}@example.com`, 'dummy', 'testuser_consumption').first<{ id: number }>()
  const home = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] consumption', crypto.randomUUID().slice(0, 16)).first<{ id: number }>()
  householdId = home!.id
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(householdId, user!.id).run()
  const cat = await env.DB.prepare('INSERT INTO zaiko_categories (household_id, name) VALUES (?, ?) RETURNING id')
    .bind(householdId, '[E2E_TEST] food').first<{ id: number }>()
  categoryId = cat!.id
  headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 10 * 366 * 86400)}` }
})
afterEach(() => vi.restoreAllMocks())

describe('自動消費API契約', () => {
  it.each([{}, { dailyConsumption: null }, { dailyConsumption: null, autoConsumptionEnabled: false }])('未設定はオフ: %j', async (extra) => {
    expect(await create(extra)).toMatchObject({ dailyConsumption: null, autoConsumptionEnabled: false })
  })
  it.each([0.1, 99999.9])('境界値%sを設定してオン', async (dailyConsumption) => {
    expect(await create({ dailyConsumption })).toMatchObject({ dailyConsumption, autoConsumptionEnabled: true })
  })
  it.each([0, -1, 0.01, 100000, '1', true])('不正な消費量%jを拒否', async (dailyConsumption) => {
    expect((await request('POST', 'inventory-items', { ...base(), dailyConsumption })).status).toBe(400)
  })
  it.each([{ autoConsumptionEnabled: true }, { dailyConsumption: null, autoConsumptionEnabled: true }, { dailyConsumption: 1, autoConsumptionEnabled: 1 }])('矛盾・非booleanを拒否: %j', async (extra) => {
    expect((await request('POST', 'inventory-items', { ...base(), ...extra })).status).toBe(400)
  })
  it('省略・同値・数量変更・購入は基準日を維持、クリア時に精算', async () => {
    const item = await create({ dailyConsumption: 0.2 })
    await anchor(item.id, '2024-02-28')
    for (const extra of [{}, { dailyConsumption: 0.2, autoConsumptionEnabled: true }]) {
      expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), ...extra })).status).toBe(200)
      expect(await row(item.id)).toMatchObject({ last_consumed_on: '2024-02-28', consumption_revision: 0 })
    }
    await request('PATCH', `inventory-items/${item.id}/quantity`, { delta: 1 })
    const entryResponse = await request('POST', 'shopping-list-items', { inventoryItemId: item.id })
    const entry = await entryResponse.json<{ id: number }>()
    const purchase = await request('POST', 'shopping-list-items/update', { items: [{ id: entry.id, purchasedQuantity: 1 }] })
    expect(purchase.status).toBe(200)
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 40, last_consumed_on: '2024-02-28', consumption_revision: 0 })
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-29T16:00:00Z'))
    expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), dailyConsumption: null })).status).toBe(200)
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 36, daily_consumption_tenths: null, auto_consumption_enabled: 0, consumption_revision: 1 })
  })
  it('停止時に精算し再開時には停止期間を除外', async () => {
    const item = await create({ dailyConsumption: 0.2 })
    await anchor(item.id)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-29T16:00:00Z'))
    await request('PATCH', `inventory-items/${item.id}`, { ...base(), autoConsumptionEnabled: false })
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 16, auto_consumption_enabled: 0 })
    await consumeInventoryForDate(env.DB, '2024-03-05')
    expect((await row(item.id))!.quantity_tenths).toBe(16)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-03-05T15:30:00Z'))
    await request('PATCH', `inventory-items/${item.id}`, { ...base(), autoConsumptionEnabled: true })
    expect(await row(item.id)).toMatchObject({ last_consumed_on: '2024-03-06', consumption_revision: 2 })
    await consumeInventoryForDate(env.DB, '2024-03-07')
    expect((await row(item.id))!.quantity_tenths).toBe(14)
  })
})

describe('日次消費と買い物リスト同期', () => {
  it('当日不変・うるう日キャッチアップ・重複実行は削除項目を復活させない', async () => {
    const item = await create({ dailyConsumption: 0.2 })
    await anchor(item.id)
    await consumeInventoryForDate(env.DB, '2024-02-28')
    expect((await row(item.id))!.quantity_tenths).toBe(20)
    await consumeInventoryForDate(env.DB, '2024-03-04')
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 10, last_consumed_on: '2024-03-04' })
    const count = () => env.DB.prepare('SELECT count(*) AS n FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first<{ n: number }>()
    expect((await count())!.n).toBe(1)
    await env.DB.prepare('DELETE FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).run()
    await consumeInventoryForDate(env.DB, '2024-03-04')
    await consumeInventoryForDate(env.DB, '2024-03-01')
    expect((await count())!.n).toBe(0)
  })
  it.each([0, 0.1, 0.2])('数量%sは0で止まり処理日を進める', async (quantity) => {
    const item = await create({ quantity, threshold: 0, dailyConsumption: 0.2 })
    await anchor(item.id)
    await consumeInventoryForDate(env.DB, '2024-03-01')
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 0, last_consumed_on: '2024-03-01' })
    await request('PATCH', `inventory-items/${item.id}/quantity`, { delta: 1 })
    await consumeInventoryForDate(env.DB, '2024-03-02')
    expect((await row(item.id))!.quantity_tenths).toBe(8)
  })
  it('同期失敗時は全件をロールバック', async () => {
    const first = await create({ dailyConsumption: 1 })
    const second = await create({ name: '[E2E_TEST] testuser_second', dailyConsumption: 1 })
    await anchor(first.id); await anchor(second.id)
    await env.DB.prepare(`CREATE TRIGGER test_consumption_failure BEFORE INSERT ON shopping_list_items WHEN NEW.inventory_item_id = ${first.id} BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run()
    try {
      await expect(consumeInventoryForDate(env.DB, '2024-02-29')).rejects.toThrow('test failure')
      expect(await row(first.id)).toMatchObject({ quantity_tenths: 20, last_consumed_on: '2024-02-28' })
      expect(await row(second.id)).toMatchObject({ quantity_tenths: 20, last_consumed_on: '2024-02-28' })
      expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE household_id = ?').bind(householdId).all()).toMatchObject({ results: [] })
    } finally { await env.DB.prepare('DROP TRIGGER test_consumption_failure').run() }
  })
})

it('予定時刻のJST日付と到来済み1時を区別', () => {
  expect(consumptionDate(Date.parse('2024-12-31T15:59:00Z'))).toBe('2025-01-01')
  expect(latestConsumptionDate(Date.parse('2024-12-31T15:59:00Z'))).toBe('2024-12-31')
  expect(latestConsumptionDate(Date.parse('2024-12-31T16:00:00Z'))).toBe('2025-01-01')
})

it('文の構築後に別Cronが確定した場合は二重消費・手動削除項目の復活を防ぐ', async () => {
  const item = await create({ dailyConsumption: 1 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-02-29')
  await consumeInventoryForDate(env.DB, '2024-02-29')
  await env.DB.prepare('DELETE FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).run()
  expect((await env.DB.batch(stale))[1].meta.changes).toBe(0)
  expect((await row(item.id))!.quantity_tenths).toBe(10)
  expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first()).toBeNull()
})
it.each([true, false])('手動増減との確定順（Cron先=%s）は更新を失わない', async (cronFirst) => {
  const item = await create({ quantity: 0.5, dailyConsumption: 1 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-02-29')
  if (cronFirst) await env.DB.batch(stale)
  expect((await request('PATCH', `inventory-items/${item.id}/quantity`, { delta: 1 })).status).toBe(200)
  if (!cronFirst) await env.DB.batch(stale)
  expect((await row(item.id))!.quantity_tenths).toBe(cronFirst ? 10 : 5)
})
it.each([true, false])('手動減算との確定順（Cron先=%s）と範囲外400', async (cronFirst) => {
  const item = await create({ quantity: 1, dailyConsumption: 0.8 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-02-29')
  if (cronFirst) await env.DB.batch(stale)
  const res = await request('PATCH', `inventory-items/${item.id}/quantity`, { delta: -0.5 })
  expect(res.status).toBe(cronFirst ? 400 : 200)
  if (!cronFirst) await env.DB.batch(stale)
  expect((await row(item.id))!.quantity_tenths).toBe(cronFirst ? 2 : 0)
})
it.each([true, false])('購入との確定順（Cron先=%s）は数量と自動リストを同期する', async (cronFirst) => {
  const item = await create({ quantity: 0.5, threshold: 1, dailyConsumption: 1 })
  await anchor(item.id)
  const entry = await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first<{ id: number }>()
  const stale = consumptionStatements(env.DB, '2024-02-29')
  if (cronFirst) await env.DB.batch(stale)
  expect((await request('POST', 'shopping-list-items/update', { items: [{ id: entry!.id, purchasedQuantity: 1 }] })).status).toBe(200)
  if (!cronFirst) await env.DB.batch(stale)
  expect((await row(item.id))!.quantity_tenths).toBe(cronFirst ? 10 : 5)
  expect(await env.DB.prepare('SELECT purchased, purchased_quantity_tenths FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first())
    .toMatchObject({ purchased: 0, purchased_quantity_tenths: 0 })
})
it('オン→オフ→オンで同値に戻っても新しい基準日以前のCronを拒否する', async () => {
  const item = await create({ dailyConsumption: 0.2 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-02-29')
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-28T17:00:00Z'))
  for (const autoConsumptionEnabled of [false, true]) {
    expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), autoConsumptionEnabled })).status).toBe(200)
  }
  const before = await row(item.id)
  expect((await env.DB.batch(stale))[1].meta.changes).toBe(0)
  expect(await row(item.id)).toEqual(before)
})
it.each([true, false])('消費量変更とCronの確定順（Cron先=%s）は旧設定を一度だけ精算する', async (cronFirst) => {
  const item = await create({ dailyConsumption: 0.2 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-03-01')
  if (cronFirst) await env.DB.batch(stale)
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-29T17:00:00Z'))
  await request('PATCH', `inventory-items/${item.id}`, { ...base(), dailyConsumption: 0.5 })
  if (!cronFirst) expect((await env.DB.batch(stale))[1].meta.changes).toBe(0)
  expect(await row(item.id)).toMatchObject({ quantity_tenths: 16, daily_consumption_tenths: 5, last_consumed_on: '2024-03-01' })
  await consumeInventoryForDate(env.DB, '2024-03-02')
  expect((await row(item.id))!.quantity_tenths).toBe(11)
})
it('古い同期の前に閾値を超えた手動加算が確定しても誤追加しない', async () => {
  const item = await create({ quantity: 1, dailyConsumption: 0.2 })
  await anchor(item.id)
  const stale = consumptionStatements(env.DB, '2024-02-29')
  await request('PATCH', `inventory-items/${item.id}/quantity`, { delta: 2 })
  await env.DB.batch(stale)
  expect((await row(item.id))!.quantity_tenths).toBe(28)
  expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first()).toBeNull()
})
it('手動項目と購入入力をCronが上書きしない', async () => {
  const item = await create({ dailyConsumption: 0.2 })
  await anchor(item.id)
  const res = await request('POST', 'shopping-list-items', { inventoryItemId: item.id })
  const entry = await res.json<{ id: number }>()
  await env.DB.prepare('UPDATE shopping_list_items SET purchased = 1, purchased_quantity_tenths = 30 WHERE id = ?').bind(entry.id).run()
  await consumeInventoryForDate(env.DB, '2024-02-29')
  expect(await env.DB.prepare('SELECT is_manual, purchased, purchased_quantity_tenths FROM shopping_list_items WHERE id = ?').bind(entry.id).first())
    .toMatchObject({ is_manual: 1, purchased: 1, purchased_quantity_tenths: 30 })
})
it('世帯外404・未認証401・同世帯メンバーは編集可能', async () => {
  const item = await create({ dailyConsumption: 0.2 })
  expect((await app.request(`/api/inventory-items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base()) }, env)).status).toBe(401)
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(`testuser_${crypto.randomUUID()}@example.com`, 'dummy', 'testuser_other').first<{ id: number }>()
  const ownHeaders = headers
  headers = { ...headers, Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 10 * 366 * 86400)}` }
  const otherHome = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] other', crypto.randomUUID().slice(0, 16)).first<{ id: number }>()
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(otherHome!.id, user!.id).run()
  expect((await request('PATCH', `inventory-items/${item.id}`, base())).status).toBe(404)
  await env.DB.prepare('UPDATE household_members SET household_id = ? WHERE user_id = ?').bind(householdId, user!.id).run()
  expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), autoConsumptionEnabled: false })).status).toBe(200)
  headers = ownHeaders
})

/** Inject a competing commit after API reads but before its first write batch. */
function beforeFirstBatch(competing: () => Promise<unknown>): D1Database {
  let first = true
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        if (first) { first = false; await competing() }
        return target.batch(statements)
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
it('PATCHの読取後に別経路で価格が更新されてもprice省略時は現在価格を維持する', async () => {
  const item = await create({ price: 100 })
  const db = beforeFirstBatch(() => env.DB.prepare('UPDATE inventory_items SET price = ? WHERE id = ?')
    .bind(250, item.id).run())
  const res = await app.request(`/api/inventory-items/${item.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ ...base(), threshold: 0.5 }),
  }, { ...env, DB: db })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ id: item.id, price: 250, threshold: 0.5 })
  expect(await env.DB.prepare('SELECT price, threshold_tenths FROM inventory_items WHERE id = ?').bind(item.id).first())
    .toEqual({ price: 250, threshold_tenths: 5 })
})
it('購入の事前読取後にCronが確定しても現在数量で購入入力をリセットする', async () => {
  const item = await create({ quantity: 0.5, threshold: 1, dailyConsumption: 1 })
  await anchor(item.id)
  const entry = await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first<{ id: number }>()
  await env.DB.prepare('UPDATE shopping_list_items SET purchased = 1, purchased_quantity_tenths = 30 WHERE id = ?').bind(entry!.id).run()
  const db = beforeFirstBatch(() => consumeInventoryForDate(env.DB, '2024-02-29'))
  const res = await app.request('/api/shopping-list-items/update', { method: 'POST', headers, body: JSON.stringify({ items: [{ id: entry!.id, purchasedQuantity: 1 }] }) }, { ...env, DB: db })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ updatedInventoryItems: [{ id: item.id, quantity: 1 }], removedShoppingListItemIds: [] })
  expect(await env.DB.prepare('SELECT purchased, purchased_quantity_tenths FROM shopping_list_items WHERE id = ?').bind(entry!.id).first())
    .toEqual({ purchased: 0, purchased_quantity_tenths: 0 })
})
it('設定変更の読取後にCronが確定したら再読取し精算を重ねない', async () => {
  const item = await create({ dailyConsumption: 0.2 })
  await anchor(item.id)
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-02-29T17:00:00Z'))
  const db = beforeFirstBatch(() => consumeInventoryForDate(env.DB, '2024-03-01'))
  const res = await app.request(`/api/inventory-items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ ...base(), dailyConsumption: 0.5 }) }, { ...env, DB: db })
  expect(res.status).toBe(200)
  expect(await row(item.id)).toMatchObject({ quantity_tenths: 16, last_consumed_on: '2024-03-01', daily_consumption_tenths: 5, consumption_revision: 1 })
})
it.each([0, -1, 0.01, 100000, '0.2', true])('PATCHも不正消費量%jを拒否し保存値を維持する', async (dailyConsumption) => {
  const item = await create({ dailyConsumption: 0.2 })
  const before = await row(item.id)
  expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), dailyConsumption })).status).toBe(400)
  expect(await row(item.id)).toEqual(before)
})
it('オフで量を登録してもCron対象外、編集で量だけを変えてもオフ', async () => {
  const item = await create({ dailyConsumption: 0.2, autoConsumptionEnabled: false })
  await anchor(item.id)
  await consumeInventoryForDate(env.DB, '2024-03-01')
  expect((await row(item.id))!.quantity_tenths).toBe(20)
  expect((await request('PATCH', `inventory-items/${item.id}`, { ...base(), dailyConsumption: 0.5 })).status).toBe(200)
  expect(await row(item.id)).toMatchObject({ quantity_tenths: 20, daily_consumption_tenths: 5, auto_consumption_enabled: 0 })
})
it('小数消費の反復でも誤差なく長期停止後も0で打ち止める', async () => {
  const item = await create({ quantity: 1, dailyConsumption: 0.1 })
  await anchor(item.id, '2024-12-30')
  for (const date of ['2024-12-31', '2025-01-01', '2025-01-02']) await consumeInventoryForDate(env.DB, date)
  expect((await row(item.id))!.quantity_tenths).toBe(7)
  await consumeInventoryForDate(env.DB, '2030-01-01')
  expect(await row(item.id)).toMatchObject({ quantity_tenths: 0, last_consumed_on: '2030-01-01' })
})
it.each([1, 105])('%s件ずつ複数世帯でも1 batch・2文で全件を消費・同期する', async (size) => {
  const other = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] other', crypto.randomUUID().slice(0, 16)).first<{ id: number }>()
  const cat = await env.DB.prepare('INSERT INTO zaiko_categories (household_id, name) VALUES (?, ?) RETURNING id')
    .bind(other!.id, '[E2E_TEST] food').first<{ id: number }>()
  for (const [home, category] of [[householdId, categoryId], [other!.id, cat!.id]]) {
    for (let i = 0; i < size; i++) await env.DB.prepare(`INSERT INTO inventory_items
      (household_id, category_id, name, quantity_tenths, threshold_tenths, daily_consumption_tenths, auto_consumption_enabled, last_consumed_on)
      VALUES (?, ?, ?, 20, 18, 1, 1, '2024-02-28')`).bind(home, category, `[E2E_TEST] testuser_bulk_${i}`).run()
  }
  const prepare = vi.fn((sql: string) => env.DB.prepare(sql))
  const batch = vi.fn((statements: D1PreparedStatement[]) => env.DB.batch(statements))
  const db = { prepare, batch } as unknown as D1Database
  for (let run = 0; run < 2; run++) {
    prepare.mockClear(); batch.mockClear()
    await consumeInventoryForDate(db, '2024-03-01')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(2)
  }
  for (const home of [householdId, other!.id]) {
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM inventory_items WHERE household_id = ?
      AND quantity_tenths = 18 AND last_consumed_on = '2024-03-01' AND consumption_revision = 0`).bind(home).first()).toEqual({ n: size })
    expect(await env.DB.prepare('SELECT count(*) AS n FROM shopping_list_items WHERE household_id = ? AND is_manual = 0').bind(home).first()).toEqual({ n: size })
  }
})

it('処理済み在庫と未処理在庫が混在しても削除済みリストを復活させない', async () => {
  const done = await create({ dailyConsumption: 1 })
  await anchor(done.id)
  await consumeInventoryForDate(env.DB, '2024-02-29')
  await env.DB.prepare('DELETE FROM shopping_list_items WHERE inventory_item_id = ?').bind(done.id).run()
  const pending = await create({ name: '[E2E_TEST] testuser_pending', dailyConsumption: 1 })
  await anchor(pending.id)
  await consumeInventoryForDate(env.DB, '2024-02-29')
  expect((await row(done.id))!.quantity_tenths).toBe(10)
  expect((await row(pending.id))!.quantity_tenths).toBe(10)
  expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(done.id).first()).toBeNull()
  expect(await env.DB.prepare('SELECT inventory_item_id FROM shopping_list_items WHERE inventory_item_id = ?').bind(pending.id).first()).toEqual({ inventory_item_id: pending.id })
})

it('2文目の数量更新に失敗した場合も先行するリスト追加をロールバックする', async () => {
  const item = await create({ dailyConsumption: 1 })
  await anchor(item.id)
  await env.DB.prepare(`CREATE TRIGGER test_consumption_update_failure BEFORE UPDATE ON inventory_items
    WHEN NEW.id = ${item.id} BEGIN SELECT RAISE(ABORT, 'test update failure'); END`).run()
  try {
    await expect(consumeInventoryForDate(env.DB, '2024-02-29')).rejects.toThrow('test update failure')
    expect(await row(item.id)).toMatchObject({ quantity_tenths: 20, last_consumed_on: '2024-02-28' })
    expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id = ?').bind(item.id).first()).toBeNull()
  } finally { await env.DB.prepare('DROP TRIGGER test_consumption_update_failure').run() }
})
