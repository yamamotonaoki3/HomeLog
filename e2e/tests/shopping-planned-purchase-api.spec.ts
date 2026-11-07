import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

const api = 'http://localhost:8787/api'
const purchasePath = '/shopping-list-items/purchases'
type Headers = { Authorization: string }
type Line = { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }
type Body = { requestId: string; items: Line[] }
type Entry = { id: number; inventoryItemId: number; plannedQuantity: number; purchaseRevision: number; price: number | null; isManual: boolean }
type Inventory = { id: number; quantity: number; price: number | null }

async function actor(request: APIRequestContext, label: string, inviteCode?: string) {
  const user = newUser('planned_' + label)
  const registered = await request.post(api + '/auth/register', { data: user })
  expect(registered.status()).toBe(201)
  const login = await request.post(api + '/auth/login', { data: { email: user.email, password: user.password } })
  expect(login.status()).toBe(200)
  const headers = { Authorization: 'Bearer ' + (await login.json()).accessToken }
  const household = await request.post(api + (inviteCode ? '/households/join' : '/households'), {
    headers, data: inviteCode ? { inviteCode } : { name: '[E2E_TEST] planned ' + label },
  })
  expect(household.status()).toBe(inviteCode ? 200 : 201)
  const me = await request.get(api + '/households/me', { headers })
  expect(me.status()).toBe(200)
  const category = await request.post(api + '/zaiko-categories', { headers, data: { name: '[E2E_TEST] planned category ' + label } })
  expect(category.status()).toBe(201)
  return { headers, categoryId: (await category.json()).id as number, inviteCode: (await me.json()).inviteCode as string }
}

async function list(request: APIRequestContext, headers: Headers): Promise<Entry[]> {
  const response = await request.get(api + '/shopping-list-items', { headers })
  expect(response.status()).toBe(200)
  return response.json()
}
async function inventory(request: APIRequestContext, headers: Headers): Promise<Inventory[]> {
  const response = await request.get(api + '/inventory-items', { headers })
  expect(response.status()).toBe(200)
  return response.json()
}
async function item(request: APIRequestContext, owner: { headers: Headers; categoryId: number }, name: string, quantity: number, threshold: number, manual = false, price = 123) {
  const response = await request.post(api + '/inventory-items', {
    headers: owner.headers, data: { name: '[E2E_TEST] ' + name, categoryId: owner.categoryId, storeId: null, quantity, threshold, price },
  })
  expect(response.status()).toBe(201)
  const created = await response.json() as Inventory
  if (manual) {
    const added = await request.post(api + '/shopping-list-items', { headers: owner.headers, data: { inventoryItemId: created.id } })
    expect(added.status()).toBe(201)
    expect(await added.json()).toMatchObject({ inventoryItemId: created.id, plannedQuantity: 1, purchaseRevision: 0, price, isManual: true })
  }
  const entry = (await list(request, owner.headers)).find(row => row.inventoryItemId === created.id)
  expect(entry).toMatchObject({ plannedQuantity: 1, purchaseRevision: 0, isManual: manual, price })
  return { inventoryId: created.id, entry: entry! }
}
async function planned(request: APIRequestContext, headers: Headers, entry: Entry, quantity: number) {
  const response = await request.patch(api + '/shopping-list-items/' + entry.id, {
    headers, data: { plannedQuantity: quantity, expectedPurchaseRevision: entry.purchaseRevision },
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ id: entry.id, plannedQuantity: quantity, purchaseRevision: entry.purchaseRevision + 1 })
  return { ...entry, plannedQuantity: quantity, purchaseRevision: entry.purchaseRevision + 1 }
}
const body = (entry: Entry, quantity: number, requestId = randomUUID()): Body => ({ requestId, items: [{ id: entry.id, purchasedQuantity: quantity, expectedPurchaseRevision: entry.purchaseRevision }] })
const send = (request: APIRequestContext, headers: Headers, value: Body) => request.post(api + purchasePath, { headers, data: value })
async function terminal(response: Awaited<ReturnType<typeof send>>, status: number) {
  expect(response.status()).toBe(status)
  const value = await response.json()
  expect(value).toMatchObject({
    code: status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'RESOURCE_NOT_FOUND' : 'RESOURCE_CONFLICT',
    details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }],
  })
  return value
}

test('予定3の部分購入は閾値超過でも残1を保持し、0と未対象を変えず同keyを再現する (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'partial')
  const target = await item(request, a, '部分購入', 0, 1)
  const zero = await item(request, a, '数量0', 0, 0)
  const untouched = await item(request, a, '未対象', 5, 0, true)
  const saved = await planned(request, a.headers, target.entry, 3)
  const initialInventory = await inventory(request, a.headers)
  const initialList = await list(request, a.headers)
  const value = body(saved, 2)
  value.items.push({ id: zero.entry.id, purchasedQuantity: 0, expectedPurchaseRevision: zero.entry.purchaseRevision })
  const first = await send(request, a.headers, value)
  expect(first.status()).toBe(200)
  const result = await first.json()
  expect(result).toEqual({ requestId: value.requestId, updatedInventoryItems: [{ id: target.inventoryId, quantity: 2 }], removedShoppingListItemIds: [], remainingShoppingListItems: [{ id: saved.id, plannedQuantity: 1, purchaseRevision: 2 }] })
  expect(await (await send(request, a.headers, value)).json()).toEqual(result)
  const afterInventory = await inventory(request, a.headers)
  const afterList = await list(request, a.headers)
  for (const record of [zero, untouched]) {
    expect(afterInventory.find(row => row.id === record.inventoryId)).toEqual(initialInventory.find(row => row.id === record.inventoryId))
    expect(afterList.find(row => row.id === record.entry.id)).toEqual(initialList.find(row => row.id === record.entry.id))
  }
  const retained = afterList.find(row => row.id === saved.id)!
  expect(retained).toMatchObject({ plannedQuantity: 1, purchaseRevision: 2 })
  // 在庫同期が走っても、閾値超過中の明示残数を除外・上書きしない。
  for (const delta of [0.1, -0.1]) expect((await request.patch(api + '/inventory-items/' + target.inventoryId + '/quantity', { headers: a.headers, data: { delta } })).status()).toBe(200)
  expect((await list(request, a.headers)).find(row => row.id === saved.id)).toEqual(retained)
  const last = await send(request, a.headers, body(retained, 1))
  expect(last.status()).toBe(200)
  expect(await last.json()).toMatchObject({ updatedInventoryItems: [{ id: target.inventoryId, quantity: 3 }], removedShoppingListItemIds: [saved.id], remainingShoppingListItems: [] })
  expect((await list(request, a.headers)).some(row => row.id === saved.id)).toBe(false)
  const replay = await send(request, a.headers, value)
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(result)
  expect((await inventory(request, a.headers)).find(row => row.id === target.inventoryId)).toMatchObject({ quantity: 3, price: 123 })
})

test('自動不足は買切り後次1、手動超過は全量加算して除外し、応答順と価格を維持する (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'transitions')
  const automatic = await item(request, a, '自動不足', 0, 5)
  const manual = await item(request, a, '手動超過', 5, 0, true, 980)
  const untouched = await item(request, a, '購入対象外', 5, 0, true)
  const manualPlan = await planned(request, a.headers, manual.entry, 3)
  const beforeInventory = await inventory(request, a.headers)
  const beforeList = await list(request, a.headers)
  const value: Body = { requestId: randomUUID(), items: [
    { id: manual.entry.id, purchasedQuantity: 4, expectedPurchaseRevision: manualPlan.purchaseRevision },
    { id: automatic.entry.id, purchasedQuantity: 1, expectedPurchaseRevision: 0 },
  ] }
  const response = await send(request, a.headers, value)
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result).toEqual({ requestId: value.requestId, updatedInventoryItems: [{ id: manual.inventoryId, quantity: 9 }, { id: automatic.inventoryId, quantity: 1 }], removedShoppingListItemIds: [manual.entry.id], remainingShoppingListItems: [{ id: automatic.entry.id, plannedQuantity: 1, purchaseRevision: 1 }] })
  const replay = await send(request, a.headers, value)
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(result)
  const afterInventory = await inventory(request, a.headers)
  const afterList = await list(request, a.headers)
  expect(afterInventory.find(row => row.id === manual.inventoryId)).toMatchObject({ quantity: 9, price: 980 })
  expect(afterInventory.find(row => row.id === untouched.inventoryId)).toEqual(beforeInventory.find(row => row.id === untouched.inventoryId))
  expect(afterList.find(row => row.id === untouched.entry.id)).toEqual(beforeList.find(row => row.id === untouched.entry.id))
  expect(afterList.find(row => row.id === automatic.entry.id)).toMatchObject({ plannedQuantity: 1, purchaseRevision: 1, isManual: false })
})

test('予定同値保存は旧購入全体を保護し、新CASの確定拒否と構造・認証拒否を区別する (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'legacy')
  const protectedItem = await item(request, a, '同値予定保護', 5, 0, true)
  const ordinary = await item(request, a, '旧互換', 5, 0, true)
  await planned(request, a.headers, protectedItem.entry, 1)
  const beforeInventory = await inventory(request, a.headers)
  const beforeList = await list(request, a.headers)
  const legacy = await request.post(api + '/shopping-list-items/update', { headers: a.headers, data: { items: [protectedItem, ordinary].map(row => ({ id: row.entry.id, purchasedQuantity: 1 })) } })
  expect(legacy.status()).toBe(409)
  expect((await legacy.json()).details ?? []).not.toContainEqual({ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' })
  expect(await inventory(request, a.headers)).toEqual(beforeInventory)
  expect(await list(request, a.headers)).toEqual(beforeList)
  const stalePatch = await request.patch(api + '/shopping-list-items/' + protectedItem.entry.id, { headers: a.headers, data: { plannedQuantity: 2, expectedPurchaseRevision: 0 } })
  expect(stalePatch.status()).toBe(409)
  expect((await stalePatch.json()).details ?? []).not.toContainEqual({ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' })
  await terminal(await send(request, a.headers, body(protectedItem.entry, 1)), 409)
  const malformed = await send(request, a.headers, { ...body(ordinary.entry, 1), requestId: 'invalid' })
  expect(malformed.status()).toBe(400)
  expect((await malformed.json()).details ?? []).not.toContainEqual({ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' })
  const unauthenticated = await request.post(api + purchasePath, { data: body(ordinary.entry, 1) })
  expect(unauthenticated.status()).toBe(401)
  expect((await unauthenticated.json()).details ?? []).not.toContainEqual({ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' })
  const oldSuccess = await request.post(api + '/shopping-list-items/update', { headers: a.headers, data: { items: [{ id: ordinary.entry.id, purchasedQuantity: 1 }] } })
  expect(oldSuccess.status()).toBe(200)
  expect(await oldSuccess.json()).toEqual({ updatedInventoryItems: [{ id: ordinary.inventoryId, quantity: 6 }], removedShoppingListItemIds: [ordinary.entry.id] })
  expect((await inventory(request, a.headers)).find(row => row.id === protectedItem.inventoryId)).toEqual(beforeInventory.find(row => row.id === protectedItem.inventoryId))
})

test('同key同body並列は両200で一度だけ購入し、actorと世帯の記録を流用しない (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'parallel_a')
  const b = await actor(request, 'parallel_b', a.inviteCode)
  const c = await actor(request, 'parallel_c')
  const target = await item(request, a, '同key並列', 0, 5)
  const own = await item(request, c, '別世帯同key', 0, 5)
  const saved = await planned(request, a.headers, target.entry, 3)
  const value = body(saved, 1)
  const responses = await Promise.all([send(request, a.headers, value), send(request, a.headers, value)])
  for (const response of responses) expect(response.status()).toBe(200)
  const snapshots = await Promise.all(responses.map(response => response.json()))
  expect(snapshots[0]).toEqual(snapshots[1])
  expect((await inventory(request, a.headers)).find(row => row.id === target.inventoryId)?.quantity).toBe(1)
  const otherActor = await terminal(await send(request, b.headers, value), 409)
  expect(otherActor).not.toHaveProperty('updatedInventoryItems')
  const otherScope = await send(request, c.headers, body(own.entry, 1, value.requestId))
  expect(otherScope.status()).toBe(200)
  expect(await otherScope.json()).toMatchObject({ requestId: value.requestId, updatedInventoryItems: [{ id: own.inventoryId, quantity: 1 }] })
  const denied = await terminal(await send(request, c.headers, { ...value, requestId: randomUUID() }), 404)
  expect(denied).not.toHaveProperty('updatedInventoryItems')
  const replay = await send(request, a.headers, value)
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(snapshots[0])
  expect((await inventory(request, a.headers)).find(row => row.id === target.inventoryId)?.quantity).toBe(1)
})

test('terminal400・404・409は条件改善と新購入後も不変で、異bodyはMISMATCHに分離する (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'terminal')
  const upper = await item(request, a, '上限terminal400', 99999.9, 0, true)
  const upperBody = body(upper.entry, 0.1)
  const rejected400 = await terminal(await send(request, a.headers, upperBody), 400)
  expect((await request.patch(api + '/inventory-items/' + upper.inventoryId + '/quantity', { headers: a.headers, data: { delta: -1 } })).status()).toBe(200)
  const old400 = await send(request, a.headers, upperBody)
  expect(old400.status()).toBe(400)
  expect(await old400.json()).toEqual(rejected400)
  const fresh400 = await send(request, a.headers, { ...upperBody, requestId: randomUUID() })
  expect(fresh400.status()).toBe(200)
  const savedQuantity = (await inventory(request, a.headers)).find(row => row.id === upper.inventoryId)?.quantity
  expect(savedQuantity).toBe(99999)
  const mismatch = await send(request, a.headers, { ...upperBody, items: [{ ...upperBody.items[0], purchasedQuantity: 0.2 }] })
  expect(mismatch.status()).toBe(409)
  expect(await mismatch.json()).toMatchObject({ code: 'SHOPPING_PURCHASE_REQUEST_MISMATCH', details: [{ field: 'requestId', reason: 'PAYLOAD_MISMATCH' }] })
  const late400 = await send(request, a.headers, upperBody)
  expect(late400.status()).toBe(400)
  expect(await late400.json()).toEqual(rejected400)
  expect((await inventory(request, a.headers)).find(row => row.id === upper.inventoryId)?.quantity).toBe(savedQuantity)

  const stale = await item(request, a, '旧revision409', 0, 5)
  const staleBody = body(stale.entry, 1)
  const revised = await planned(request, a.headers, stale.entry, 1)
  const rejected409 = await terminal(await send(request, a.headers, staleBody), 409)
  expect((await send(request, a.headers, body(revised, 1))).status()).toBe(200)
  for (let attempt = 0; attempt < 2; attempt++) {
    const late = await send(request, a.headers, staleBody)
    expect(late.status()).toBe(409)
    expect(await late.json()).toEqual(rejected409)
  }
  expect((await inventory(request, a.headers)).find(row => row.id === stale.inventoryId)?.quantity).toBe(1)

  const removed = await item(request, a, '削除再追加404', 5, 0, true)
  expect((await request.delete(api + '/shopping-list-items/' + removed.entry.id, { headers: a.headers })).status()).toBe(204)
  const missingBody = body(removed.entry, 1)
  const rejected404 = await terminal(await send(request, a.headers, missingBody), 404)
  const readd = await request.post(api + '/shopping-list-items', { headers: a.headers, data: { inventoryItemId: removed.inventoryId } })
  expect(readd.status()).toBe(201)
  const newEntry = await readd.json() as Entry
  expect(newEntry.id).not.toBe(removed.entry.id)
  const old404 = await send(request, a.headers, missingBody)
  expect(old404.status()).toBe(404)
  expect(await old404.json()).toEqual(rejected404)
  expect((await send(request, a.headers, body(newEntry, 1))).status()).toBe(200)
  const late404 = await send(request, a.headers, missingBody)
  expect(late404.status()).toBe(404)
  expect(await late404.json()).toEqual(rejected404)
  expect((await inventory(request, a.headers)).find(row => row.id === removed.inventoryId)?.quantity).toBe(6)
})

test('実commit後503で結果が失われても元keyを回復し、削除済行へ再加算しない (#455)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await actor(request, 'lost_response')
  const target = await item(request, a, '応答喪失', 5, 0, true)
  const value = body(target.entry, 2)
  await page.goto('/login')
  consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  let committed: unknown
  let browserPosts = 0
  await page.route('**/api/shopping-list-items/purchases', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    browserPosts++
    const actual = await route.fetch()
    expect(actual.status()).toBe(200)
    committed = await actual.json()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'EXTERNAL_SERVICE_ERROR', message: '[E2E_TEST] 保存後に応答が失われました', details: [] }) })
  })
  const lostStatus = await page.evaluate(async ({ headers, value }) => {
    const response = await fetch('/api/shopping-list-items/purchases', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    return response.status
  }, { headers: a.headers, value })
  expect(lostStatus).toBe(503)
  expect(browserPosts).toBe(1)
  await page.unroute('**/api/shopping-list-items/purchases')
  expect((await list(request, a.headers)).some(row => row.id === target.entry.id)).toBe(false)
  const replay = await send(request, a.headers, value)
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(committed)
  expect(committed).toEqual({ requestId: value.requestId, updatedInventoryItems: [{ id: target.inventoryId, quantity: 7 }], removedShoppingListItemIds: [target.entry.id], remainingShoppingListItems: [] })
  const mismatch = await send(request, a.headers, { ...value, items: [{ ...value.items[0], purchasedQuantity: 3 }] })
  expect(mismatch.status()).toBe(409)
  expect(await mismatch.json()).toMatchObject({ code: 'SHOPPING_PURCHASE_REQUEST_MISMATCH', details: [{ field: 'requestId', reason: 'PAYLOAD_MISMATCH' }] })
  const original = await send(request, a.headers, value)
  expect(original.status()).toBe(200)
  expect(await original.json()).toEqual(committed)
  expect((await inventory(request, a.headers)).find(row => row.id === target.inventoryId)).toMatchObject({ quantity: 7, price: 123 })
})
