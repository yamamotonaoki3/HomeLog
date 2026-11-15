import { randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

const api = (path: string) => `http://127.0.0.1:8787/api/${path}`
type Headers = { Authorization: string }
interface Link {
  id: number; recipeId: number | null; recipeTitle: string
  remainingCount: number; memo: string | null; carryEnabled: boolean
}
interface Item {
  id: number; name: string; categoryId: number; storeId: number | null
  quantity: number; threshold: number; price: number | null
  dailyConsumption: number | null; autoConsumptionEnabled: boolean
  menuPlanEnabled: boolean; menuPlanRevision: number; menuLinks: Link[]
}
interface Entry {
  id: number; recipeId: number | null; recipeTitle: string | null
  inventoryLinkage: null | {
    linkId: number | null; inventoryItemId: number; remainingCount: number | null
    memo: string | null; mealRevision: number; canConsume: boolean; canUndo: boolean
    undoQuantity: number | null; menuPlanEnabled: boolean | null
  }
}
interface Success {
  quantity: number; remainingCount: number | null; mealRevision: number
  menuPlanEnabled: boolean; menuPlanRevision: number
}
async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status)
  return response.json() as Promise<T>
}
async function household(request: APIRequestContext, label: string): Promise<Headers> {
  const user = newUser(label)
  await json(await request.post(api('auth/register'), { data: user }), 201)
  const login = await json<{ accessToken: string }>(await request.post(api('auth/login'), { data: { email: user.email, password: user.password } }))
  const headers = { Authorization: `Bearer ${login.accessToken}` }
  await json(await request.post(api('households'), { headers, data: { name: '[E2E_TEST] planned meals' } }), 201)
  return headers
}
function weekStart(): string {
  const date = new Date(Date.now() + 9 * 3_600_000)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
async function inventory(request: APIRequestContext, headers: Headers, id: number): Promise<Item> {
  const rows = await json<Item[]>(await request.get(api('inventory-items'), { headers }))
  const item = rows.find(row => row.id === id)
  expect(item).toBeDefined()
  return item!
}
async function entries(request: APIRequestContext, headers: Headers): Promise<Entry[]> {
  return json(await request.get(api(`menu-entries?weekStartDate=${weekStart()}`), { headers }))
}
function replace(item: Item, overrides: Record<string, unknown> = {}) {
  return {
    name: item.name, categoryId: item.categoryId, storeId: item.storeId,
    quantity: item.quantity, threshold: item.threshold, price: item.price,
    dailyConsumption: item.dailyConsumption, autoConsumptionEnabled: item.autoConsumptionEnabled,
    expectedMenuPlanRevision: item.menuPlanRevision,
    menuPlan: { requestId: randomUUID(), enabled: item.menuPlanEnabled, links: item.menuLinks.map(link => ({ linkId: link.id, remainingCount: link.remainingCount, memo: link.memo, carryEnabled: link.carryEnabled })) },
    ...overrides,
  }
}
async function fixture(request: APIRequestContext, label: string) {
  const headers = await household(request, label)
  const recipe = await json<{ id: number }>(await request.post(api('recipes'), { headers, data: { title: '[E2E_TEST] curry' } }), 201)
  const categories = await json<{ id: number }[]>(await request.get(api('zaiko-categories'), { headers }))
  const body = {
    name: `[E2E_TEST] chicken ${label}`, categoryId: categories[0].id, storeId: null,
    quantity: 5, threshold: 1, price: 120, dailyConsumption: null, autoConsumptionEnabled: false,
    menuPlan: { requestId: randomUUID(), enabled: true, links: [
      { recipeId: recipe.id, remainingCount: 2, memo: '辛口', carryEnabled: true },
      { newRecipeTitle: '[E2E_TEST] oyakodon', remainingCount: 3, memo: null, carryEnabled: true },
    ] },
  }
  return { headers, recipeId: recipe.id, body }
}

// #554の新planned契約。旧menuLinkage契約はmenu-inventory-api.spec.tsで別途維持する。
test('予定の一括保存・同ID並行再送・全未反映・世帯分離を実Workersで確認する', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  const { headers, body } = await fixture(request, 'plan_atomic')
  const responses = await Promise.all([request.post(api('inventory-items'), { headers, data: body }), request.post(api('inventory-items'), { headers, data: body })])
  const created = await json<Item>(responses[0], 201)
  expect(await json<Item>(responses[1], 201)).toEqual(created)
  expect(created).toMatchObject({ quantity: 5, price: 120, menuPlanEnabled: true })
  expect((await request.post(api('inventory-items'), { headers, data: { ...body, name: '[E2E_TEST] same ID different body' } })).status()).toBe(409)
  let item = await inventory(request, headers, created.id)
  expect(item.menuLinks.map(link => [link.remainingCount, link.memo])).toEqual([[2, '辛口'], [3, null]])
  expect((await json<Item[]>(await request.get(api('inventory-items'), { headers }))).filter(row => row.id === created.id)).toHaveLength(1)

  const update = replace(item, { quantity: 6, threshold: 2, price: 150, menuPlan: { requestId: randomUUID(), enabled: true, links: item.menuLinks.map((link, index) => ({ linkId: link.id, remainingCount: 3, memo: index ? null : '中辛', carryEnabled: link.carryEnabled })) } })
  const saves = await Promise.all([request.put(api(`inventory-items/${item.id}`), { headers, data: update }), request.put(api(`inventory-items/${item.id}`), { headers, data: update })])
  const saved = await json<Item>(saves[0])
  expect(await json<Item>(saves[1])).toEqual(saved)
  item = await inventory(request, headers, item.id)
  expect(item).toMatchObject({ quantity: 6, threshold: 2, price: 150, menuPlanEnabled: true })
  expect(item.menuLinks.map(link => link.remainingCount)).toEqual([3, 3])
  expect(item.menuLinks[0].memo).toBe('中辛')
  expect((await request.put(api(`inventory-items/${item.id}`), { headers, data: { ...update, menuPlan: { ...update.menuPlan, requestId: randomUUID() } } })).status()).toBe(409)

  const recipeBefore = await json<unknown[]>(await request.get(api('recipes'), { headers }))
  const over = replace(item, { name: '[E2E_TEST] should rollback', quantity: 5, menuPlan: { requestId: randomUUID(), enabled: true, links: [
    ...item.menuLinks.map(link => ({ linkId: link.id, remainingCount: link.remainingCount, memo: link.memo, carryEnabled: link.carryEnabled })),
    { newRecipeTitle: '[E2E_TEST] must not create', remainingCount: 1, memo: null, carryEnabled: false },
  ] } })
  expect((await request.put(api(`inventory-items/${item.id}`), { headers, data: over })).status()).toBe(400)
  expect(await inventory(request, headers, item.id)).toEqual(item)
  expect(await json<unknown[]>(await request.get(api('recipes'), { headers }))).toEqual(recipeBefore)
  expect((await request.patch(api(`inventory-items/${item.id}/quantity`), { headers, data: { delta: -1 } })).status()).toBe(400)
  expect(await inventory(request, headers, item.id)).toEqual(item)

  const foreign = await household(request, 'plan_foreign')
  expect((await request.put(api(`inventory-items/${item.id}`), { headers: foreign, data: replace(item) })).status()).toBe(404)
  const row = (await entries(request, headers)).find(entry => entry.inventoryLinkage?.linkId === item.menuLinks[0].id)!
  for (const operation of ['consume', 'undo-consumption']) {
    expect((await request.post(api(`menu-entries/${row.id}/${operation}`), { headers: foreign, data: { requestId: randomUUID(), expectedRevision: row.inventoryLinkage!.mealRevision } })).status()).toBe(404)
  }
  expect(await entries(request, foreign)).toEqual([])
  expect(await inventory(request, headers, item.id)).toEqual(item)
})

test('食べた1回と在庫1の連動・繰返し・LIFO取消・品目OFF中取消を実Workersで確認する', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  const { headers, body, recipeId } = await fixture(request, 'plan_meal')
  const created = await json<Item>(await request.post(api('inventory-items'), { headers, data: body }), 201)
  const second = await json<Item>(await request.post(api('inventory-items'), { headers, data: { ...body, name: '[E2E_TEST] independent chicken', quantity: 2, menuPlan: { requestId: randomUUID(), enabled: true, links: [{ recipeId, remainingCount: 1, memo: null, carryEnabled: true }] } } }), 201)
  const rowId = (await entries(request, headers)).find(row => row.inventoryLinkage?.linkId === created.menuLinks[0].id)!.id
  const row = async () => (await entries(request, headers)).find(entry => entry.id === rowId)!
  const mutate = async (operation: string) => json<Success>(await request.post(api(`menu-entries/${rowId}/${operation}`), { headers, data: { requestId: randomUUID(), expectedRevision: (await row()).inventoryLinkage!.mealRevision } }))
  const firstBody = { requestId: randomUUID(), expectedRevision: (await row()).inventoryLinkage!.mealRevision }
  const first = await Promise.all([request.post(api(`menu-entries/${rowId}/consume`), { headers, data: firstBody }), request.post(api(`menu-entries/${rowId}/consume`), { headers, data: firstBody })])
  const firstSnapshot = await json<Success>(first[0])
  expect(await json<Success>(first[1])).toEqual(firstSnapshot)
  expect(firstSnapshot).toMatchObject({ quantity: 4, remainingCount: 1 })
  expect((await row()).inventoryLinkage).toMatchObject({ remainingCount: 1, canConsume: true, canUndo: true, undoQuantity: 1 })
  expect(await inventory(request, headers, second.id)).toMatchObject({ quantity: 2, menuLinks: [expect.objectContaining({ remainingCount: 1 })] })
  expect(await mutate('consume')).toMatchObject({ quantity: 3, remainingCount: 0 })
  expect((await row()).inventoryLinkage).toMatchObject({ canConsume: false, canUndo: true, remainingCount: 0 })
  const depleted = await inventory(request, headers, created.id)
  expect((await request.post(api(`menu-entries/${rowId}/consume`), { headers, data: { requestId: randomUUID(), expectedRevision: (await row()).inventoryLinkage!.mealRevision } })).status()).toBe(409)
  expect(await inventory(request, headers, created.id)).toEqual(depleted)
  expect(await mutate('undo-consumption')).toMatchObject({ quantity: 4, remainingCount: 1 })
  expect(await mutate('undo-consumption')).toMatchObject({ quantity: 5, remainingCount: 2 })
  expect((await row()).inventoryLinkage).toMatchObject({ canConsume: true, canUndo: false, undoQuantity: null })

  expect(await mutate('consume')).toMatchObject({ quantity: 4, remainingCount: 1 })
  const beforeOff = await inventory(request, headers, created.id)
  await json(await request.put(api(`inventory-items/${created.id}`), { headers, data: replace(beforeOff, { menuPlan: { ...replace(beforeOff).menuPlan, enabled: false } }) }))
  expect((await row()).inventoryLinkage).toMatchObject({ canConsume: false, canUndo: true, menuPlanEnabled: false })
  expect(await mutate('undo-consumption')).toMatchObject({ quantity: 5, remainingCount: 2, menuPlanEnabled: false })
  const off = await inventory(request, headers, created.id)
  expect(off.menuLinks.map(link => [link.remainingCount, link.carryEnabled])).toEqual([[2, true], [3, true]])
  expect((await request.put(api(`inventory-items/${off.id}`), { headers, data: replace(off, { dailyConsumption: 1, autoConsumptionEnabled: true }) })).status()).toBe(400)
  expect(await inventory(request, headers, off.id)).toEqual(off)

  // 予定0後はdailyをONにできるが、countを戻す取消はOFFにするまで不可。
  const secondRow = async () => (await entries(request, headers)).find(entry => entry.inventoryLinkage?.linkId === second.menuLinks[0].id)!
  const secondEntry = await secondRow()
  await json(await request.post(api(`menu-entries/${secondEntry.id}/consume`), { headers, data: { requestId: randomUUID(), expectedRevision: secondEntry.inventoryLinkage!.mealRevision } }))
  const zero = await inventory(request, headers, second.id)
  expect(zero).toMatchObject({ quantity: 1, menuLinks: [expect.objectContaining({ remainingCount: 0 })] })
  await json(await request.put(api(`inventory-items/${second.id}`), { headers, data: replace(zero, { dailyConsumption: 1, autoConsumptionEnabled: true }) }))
  expect((await secondRow()).inventoryLinkage?.canUndo).toBe(false)
  const daily = await inventory(request, headers, second.id)
  expect(daily.autoConsumptionEnabled).toBe(true)
  expect((await request.post(api(`menu-entries/${secondEntry.id}/undo-consumption`), { headers, data: { requestId: randomUUID(), expectedRevision: (await secondRow()).inventoryLinkage!.mealRevision } })).status()).toBe(409)
  expect(await inventory(request, headers, second.id)).toEqual(daily)
  await json(await request.put(api(`inventory-items/${second.id}`), { headers, data: replace(daily, { autoConsumptionEnabled: false }) }))
  expect((await secondRow()).inventoryLinkage?.canUndo).toBe(true)
  expect(await json<Success>(await request.post(api(`menu-entries/${secondEntry.id}/undo-consumption`), { headers, data: { requestId: randomUUID(), expectedRevision: (await secondRow()).inventoryLinkage!.mealRevision } }))).toMatchObject({ quantity: 2, remainingCount: 1 })
})

test('解除は在庫と原本を保持し再追加は別ID、過去取消は在庫だけ返すことを実Workersで確認する', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  const { headers, body, recipeId } = await fixture(request, 'plan_unlink')
  const created = await json<Item>(await request.post(api('inventory-items'), { headers, data: body }), 201)
  const originalLink = created.menuLinks[0].id
  const originalEntry = (await entries(request, headers)).find(row => row.inventoryLinkage?.linkId === originalLink)!
  await json(await request.post(api(`menu-entries/${originalEntry.id}/consume`), { headers, data: { requestId: randomUUID(), expectedRevision: originalEntry.inventoryLinkage!.mealRevision } }))
  expect((await request.patch(api(`recipes/${recipeId}`), { headers, data: { title: '[E2E_TEST] renamed curry' } })).status()).toBe(200)
  const consumed = await inventory(request, headers, created.id)
  const retained = consumed.menuLinks.filter(link => link.id !== originalLink)
  await json(await request.put(api(`inventory-items/${created.id}`), { headers, data: replace(consumed, { menuPlan: { requestId: randomUUID(), enabled: true, links: retained.map(link => ({ linkId: link.id, remainingCount: link.remainingCount, memo: link.memo, carryEnabled: link.carryEnabled })) } }) }))
  const detached = (await entries(request, headers)).find(row => row.id === originalEntry.id)!
  expect(detached.recipeTitle).toBe('[E2E_TEST] curry')
  expect(detached.inventoryLinkage).toMatchObject({ linkId: null, canConsume: false, canUndo: true, remainingCount: null, undoQuantity: 1 })
  expect((await inventory(request, headers, created.id)).quantity).toBe(4)
  for (const [path, field] of [['dashboard/summary', 'weeklyMenuEntries'], [`dashboard/day-detail?date=${weekStart()}`, 'menuEntries']]) {
    const view = await json<Record<string, unknown[]>>(await request.get(api(path), { headers }))
    expect(view[field]).toContainEqual(expect.objectContaining({ recipeId, recipeTitle: '[E2E_TEST] curry' }))
  }
  const unlinked = await inventory(request, headers, created.id)
  const readded = await json<Item>(await request.put(api(`inventory-items/${created.id}`), { headers, data: replace(unlinked, { menuPlan: { requestId: randomUUID(), enabled: true, links: [
    ...unlinked.menuLinks.map(link => ({ linkId: link.id, remainingCount: link.remainingCount, memo: link.memo, carryEnabled: link.carryEnabled })),
    { recipeId, remainingCount: 1, memo: '再追加', carryEnabled: true },
  ] } }) }))
  const newLink = readded.menuLinks.find(link => link.recipeId === recipeId)!
  expect(newLink.id).not.toBe(originalLink)
  const undoBody = { requestId: randomUUID(), expectedRevision: detached.inventoryLinkage!.mealRevision }
  const undone = await json<Success>(await request.post(api(`menu-entries/${originalEntry.id}/undo-consumption`), { headers, data: undoBody }))
  expect(undone).toMatchObject({ quantity: 5, remainingCount: null })
  expect(await json<Success>(await request.post(api(`menu-entries/${originalEntry.id}/undo-consumption`), { headers, data: undoBody }))).toEqual(undone)
  const after = await inventory(request, headers, created.id)
  expect(after.menuLinks.find(link => link.id === newLink.id)).toMatchObject({ remainingCount: 1, memo: '再追加' })
  expect(after.menuLinks.find(link => link.id === retained[0].id)?.remainingCount).toBe(3)
  const originals = await json<{ id: number; title: string }[]>(await request.get(api('recipes'), { headers }))
  expect(originals).toContainEqual(expect.objectContaining({ id: recipeId, title: '[E2E_TEST] renamed curry' }))
})
