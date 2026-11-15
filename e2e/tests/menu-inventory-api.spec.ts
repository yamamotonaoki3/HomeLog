import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

const origin = 'http://127.0.0.1:8787'

async function newHousehold(request: APIRequestContext, label: string) {
  const user = newUser(label)
  expect((await request.post(`${origin}/api/auth/register`, { data: user })).status()).toBe(201)
  const login = await request.post(`${origin}/api/auth/login`, { data: { email: user.email, password: user.password } })
  expect(login.status()).toBe(200)
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` }
  expect((await request.post(`${origin}/api/households`, { headers, data: { name: '[E2E_TEST] menu inventory' } })).status()).toBe(201)
  return headers
}

interface Entry {
  recipeId: number | null
  recipeTitle: string | null
  id: number
  inventoryLinkage: null | {
    linkId: number; inventoryItemId: number; quantity: number; usageQuantity: number
    enabled: boolean; carryEnabled: boolean; linkRevision: number
    mealState: 'uneaten' | 'eaten'; mealRevision: number; canConsume: boolean; canUndo: boolean
  }
}

// #547承認契約に対する実WorkersのAPI層E2E。画面の新UIは後続#548。
test('実Workersで複数レシピ登録・食事・取消・再送・世帯分離を確認する', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  const headers = await newHousehold(request, 'menu_linkage')
  const api = (path: string) => `${origin}/api/${path}`
  const existingRecipe = await request.post(api('recipes'), { headers, data: { title: '[E2E_TEST] existing recipe' } })
  expect(existingRecipe.status()).toBe(201)
  const recipeId = (await existingRecipe.json()).id
  const categoriesResponse = await request.get(api('zaiko-categories'), { headers })
  expect(categoriesResponse.status()).toBe(200)
  const categoryId = (await categoriesResponse.json())[0].id
  const body = {
    name: '[E2E_TEST] chicken portions', categoryId, storeId: null, quantity: 3, threshold: 1,
    menuLinkage: {
      requestId: randomUUID(),
      menus: [
        { newRecipeTitle: '[E2E_TEST] chicken ham', usageQuantity: 1, carryEnabled: true },
        { recipeId, usageQuantity: 1, carryEnabled: true },
        { newRecipeTitle: '[E2E_TEST] chicken teriyaki', usageQuantity: 1, carryEnabled: true },
      ],
    },
  }
  const creates = await Promise.all([request.post(api('inventory-items'), { headers, data: body }), request.post(api('inventory-items'), { headers, data: body })])
  expect(creates.map(r => r.status())).toEqual([201, 201])
  const created = await creates[0].json()
  expect(await creates[1].json()).toEqual(created)
  expect(created.quantity).toBe(3)
  const readInventory = async () => {
    const response = await request.get(api('inventory-items'), { headers })
    expect(response.status()).toBe(200)
    return (await response.json()).find((row: { id: number }) => row.id === created.id)
  }
  expect((await readInventory()).menuLinks).toHaveLength(3)
  const recipes = await request.get(api('recipes'), { headers })
  expect(recipes.status()).toBe(200)
  expect(await recipes.json()).toHaveLength(3)
  const jst = new Date(Date.now() + 9 * 3_600_000)
  jst.setUTCDate(jst.getUTCDate() - ((jst.getUTCDay() + 6) % 7))
  const week = jst.toISOString().slice(0, 10)
  const readEntries = async (): Promise<Entry[]> => {
    const response = await request.get(api(`menu-entries?weekStartDate=${week}`), { headers })
    expect(response.status()).toBe(200)
    return response.json()
  }
  const entries = (await readEntries()).filter(row => row.inventoryLinkage?.inventoryItemId === created.id)
  expect(entries).toHaveLength(3)
  for (const row of entries) expect(row.inventoryLinkage).toMatchObject({ quantity: 3, usageQuantity: 1, mealState: 'uneaten', canConsume: true, canUndo: false })
  const consumeBody = { requestId: randomUUID(), expectedRevision: 0 }
  const consumeUrl = api(`menu-entries/${entries[0].id}/consume`)
  const consumed = await Promise.all([request.post(consumeUrl, { headers, data: consumeBody }), request.post(consumeUrl, { headers, data: consumeBody })])
  expect(consumed.map(r => r.status())).toEqual([200, 200])
  const snapshot = await consumed[0].json()
  expect(await consumed[1].json()).toEqual(snapshot)
  expect(snapshot).toMatchObject({ quantity: 2, mealState: 'eaten', mealRevision: 1 })
  expect((await readInventory()).quantity).toBe(2)
  expect((await request.post(consumeUrl, { headers, data: { requestId: randomUUID(), expectedRevision: 1 } })).status()).toBe(409)
  const undo = await request.post(api(`menu-entries/${entries[0].id}/undo-consumption`), { headers, data: { requestId: randomUUID(), expectedRevision: 1 } })
  expect(undo.status()).toBe(200)
  expect(await undo.json()).toMatchObject({ quantity: 3, mealState: 'uneaten', mealRevision: 2 })
  for (const [index, entry] of entries.entries()) {
    const response = await request.post(api(`menu-entries/${entry.id}/consume`), { headers, data: { requestId: randomUUID(), expectedRevision: index === 0 ? 2 : 0 } })
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ quantity: 2 - index, mealState: 'eaten' })
  }
  const zero = await readInventory()
  expect(zero.quantity).toBe(0)
  expect(zero.menuLinks.every((link: { carryEnabled: boolean }) => !link.carryEnabled)).toBe(true)
  const zeroLink = zero.menuLinks[0]
  const disabledResponse = await request.patch(api(`inventory-menu-links/${zeroLink.id}`), { headers, data: { expectedRevision: zeroLink.revision, usageQuantity: zeroLink.usageQuantity, enabled: false, carryEnabled: false } })
  expect(disabledResponse.status()).toBe(200)
  const link = await disabledResponse.json()
  const zeroReactivation = await request.patch(api(`inventory-menu-links/${link.id}`), { headers, data: { expectedRevision: link.revision, usageQuantity: 2, enabled: true, carryEnabled: false } })
  expect(zeroReactivation.status()).toBe(409)
  expect((await readInventory()).menuLinks.find((row: { id: number }) => row.id === link.id)).toEqual(link)
  expect((await readEntries()).filter(row => row.inventoryLinkage?.inventoryItemId === created.id)).toHaveLength(3)
  const patch = { expectedRevision: link.revision, usageQuantity: link.usageQuantity, enabled: true, carryEnabled: true }
  expect((await request.patch(api(`inventory-menu-links/${link.id}`), { headers, data: patch })).status()).toBe(409)
  const refill = await request.patch(api(`inventory-items/${created.id}/quantity`), { headers, data: { delta: 1 } })
  expect(refill.status()).toBe(200)
  expect((await readInventory()).menuLinks.every((row: { carryEnabled: boolean }) => !row.carryEnabled)).toBe(true)
  const reenabled = await request.patch(api(`inventory-menu-links/${link.id}`), { headers, data: patch })
  expect(reenabled.status()).toBe(200)
  expect(await reenabled.json()).toMatchObject({ carryEnabled: true, revision: link.revision + 1 })
  expect((await request.patch(api(`inventory-menu-links/${link.id}`), { headers, data: patch })).status()).toBe(409)
  const retained = (await readEntries()).find(row => row.inventoryLinkage?.linkId === link.id)!
  expect(retained.inventoryLinkage).toMatchObject({ mealState: 'eaten', canConsume: false })
  expect((await readEntries()).filter(row => row.inventoryLinkage?.inventoryItemId === created.id)).toHaveLength(3)
  const linkedRecipeEntry = (await readEntries()).find(row => row.recipeId === recipeId && row.inventoryLinkage)!
  expect(linkedRecipeEntry.recipeTitle).toBe('[E2E_TEST] existing recipe')
  expect((await request.patch(api(`recipes/${recipeId}`), { headers, data: { title: '[E2E_TEST] renamed recipe' } })).status()).toBe(200)
  expect((await readEntries()).find(row => row.id === linkedRecipeEntry.id)?.recipeTitle).toBe('[E2E_TEST] existing recipe')
  const dashboardWeekViews = [
    { path: 'dashboard/summary', field: 'weeklyMenuEntries' },
    { path: `dashboard/day-detail?date=${week}`, field: 'menuEntries' },
  ]
  const assertDashboardTitle = async (expectedRecipeId: number | null) => {
    for (const view of dashboardWeekViews) {
      const response = await request.get(api(view.path), { headers })
      expect(response.status()).toBe(200)
      const rows = (await response.json())[view.field] as { recipeId: number | null; recipeTitle: string | null }[]
      expect(rows).toContainEqual(expect.objectContaining({ recipeId: expectedRecipeId, recipeTitle: '[E2E_TEST] existing recipe' }))
    }
  }
  await assertDashboardTitle(recipeId)
  expect((await readInventory()).menuLinks.find((row: { recipeId: number }) => row.recipeId === recipeId).recipeTitle).toBe('[E2E_TEST] renamed recipe')
  expect((await request.delete(api(`recipes/${recipeId}`), { headers })).status()).toBe(204)
  await assertDashboardTitle(null)
  const deletedOriginalEntry = (await readEntries()).find(row => row.id === linkedRecipeEntry.id)!
  expect(deletedOriginalEntry).toMatchObject({ recipeId: null, recipeTitle: '[E2E_TEST] existing recipe', inventoryLinkage: { canConsume: false, canUndo: true } })
  const undoDeletedOriginal = await request.post(api(`menu-entries/${linkedRecipeEntry.id}/undo-consumption`), { headers, data: { requestId: randomUUID(), expectedRevision: linkedRecipeEntry.inventoryLinkage!.mealRevision } })
  expect(undoDeletedOriginal.status()).toBe(200)
  expect(await undoDeletedOriginal.json()).toMatchObject({ quantity: 2, mealState: 'uneaten' })
  const replayCreation = await request.post(api('inventory-items'), { headers, data: body })
  expect(replayCreation.status()).toBe(201)
  expect(await replayCreation.json()).toEqual(created)
  const other = await newHousehold(request, 'menu_other')
  expect((await request.post(consumeUrl, { headers: other, data: { requestId: randomUUID(), expectedRevision: 3 } })).status()).toBe(404)
  expect((await request.get(api('inventory-items'), { headers: other })).ok()).toBe(true)
  expect((await request.get(api('inventory-items'), { headers })).ok()).toBe(true)
})
