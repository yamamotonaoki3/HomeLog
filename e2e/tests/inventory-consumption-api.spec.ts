import { expect, test } from './console-guard'
import { setupConsumptionUser } from './support/inventory-consumption'

test('日次消費の登録・編集・手動増減・購入API契約 (#329)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupConsumptionUser(page, 'consumption_api')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
  const data = { name: '[E2E_TEST] testuser_consumption', categoryId: categories[0].id, storeId: null, quantity: 0.5, threshold: 1 }
  const created = await page.request.post('/api/inventory-items', { headers, data: { ...data, dailyConsumption: 0.2 } })
  expect(created.status()).toBe(201)
  const item = await created.json()
  expect(item).toMatchObject({ dailyConsumption: 0.2, autoConsumptionEnabled: true, quantity: 0.5 })
  expect(item).not.toHaveProperty('lastConsumedOn')
  expect(item).not.toHaveProperty('consumptionRevision')
  const path = `/api/inventory-items/${item.id}`
  expect((await page.request.patch(path, { headers, data })).status()).toBe(200)
  const read = async () => (await (await page.request.get('/api/inventory-items', { headers })).json()).find((row: { id: number }) => row.id === item.id)
  expect(await read()).toMatchObject({ dailyConsumption: 0.2, autoConsumptionEnabled: true })
  expect((await page.request.patch(`${path}/quantity`, { headers, data: { delta: 0.1 } })).status()).toBe(200)
  const shopping = await (await page.request.get('/api/shopping-list-items', { headers })).json()
  const entry = shopping.find((row: { inventoryItemId: number }) => row.inventoryItemId === item.id)
  const purchase = await page.request.post('/api/shopping-list-items/update', { headers, data: { items: [{ id: entry.id, purchasedQuantity: 0.1 }] } })
  expect(purchase.status()).toBe(200)
  expect(await purchase.json()).toMatchObject({ updatedInventoryItems: [{ id: item.id, quantity: 0.7 }], removedShoppingListItemIds: [] })
  expect(await read()).toMatchObject({ quantity: 0.7, dailyConsumption: 0.2, autoConsumptionEnabled: true })
  const stopped = await page.request.patch(path, { headers, data: { ...data, autoConsumptionEnabled: false } })
  expect(stopped.status()).toBe(200)
  expect(await stopped.json()).toMatchObject({ dailyConsumption: 0.2, autoConsumptionEnabled: false })
  const cleared = await page.request.patch(path, { headers, data: { ...data, dailyConsumption: null } })
  expect(cleared.status()).toBe(200)
  expect(await cleared.json()).toMatchObject({ dailyConsumption: null, autoConsumptionEnabled: false })
})
