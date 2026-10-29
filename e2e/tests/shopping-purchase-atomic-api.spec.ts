import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('買い物は不正品目があれば全件拒否し、同時購入でも在庫を一度だけ加算する (#394)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'purchase_atomic')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const categoryResponse = await page.request.post('/api/zaiko-categories', { headers, data: { name: '[E2E_TEST] purchase category' } })
  expect(categoryResponse.status()).toBe(201)
  const { id: categoryId } = await categoryResponse.json()
  const items: { id: number; entryId: number }[] = []
  for (let index = 0; index < 3; index++) {
    const response = await page.request.post('/api/inventory-items', { headers, data: { name: `[E2E_TEST] purchase ${index}`, categoryId, storeId: null, quantity: 5, threshold: 0 } })
    expect(response.status()).toBe(201)
    const { id } = await response.json()
    const added = await page.request.post('/api/shopping-list-items', { headers, data: { inventoryItemId: id } })
    expect(added.status()).toBe(201)
    items.push({ id, entryId: (await added.json()).id })
  }
  const purchase = (lines: { id: number; purchasedQuantity: number }[]) => page.request.post('/api/shopping-list-items/update', { headers, data: { items: lines } })
  const valid = items.map((item) => ({ id: item.entryId, purchasedQuantity: 1 }))
  const invalid = valid.map((line, index) => index === 1 ? { ...line, id: 2147483647 } : line)
  expect((await purchase(invalid)).status()).toBe(404)
  const initialResponse = await page.request.get('/api/inventory-items', { headers })
  expect(initialResponse.status()).toBe(200)
  const initial = await initialResponse.json()
  expect(initial).toHaveLength(3)
  expect(initial.every((item: { quantity: number }) => item.quantity === 5)).toBe(true)
  const initialList = await page.request.get('/api/shopping-list-items', { headers })
  expect(initialList.status()).toBe(200)
  expect(await initialList.json()).toHaveLength(3)

  const responses = await Promise.all([purchase(valid), purchase(valid)])
  expect(responses.filter((response) => response.status() === 200)).toHaveLength(1)
  expect([404, 409]).toContain(responses.find((response) => response.status() !== 200)!.status())
  expect(await responses.find((response) => response.status() === 200)!.json()).toEqual({
    updatedInventoryItems: items.map((item) => ({ id: item.id, quantity: 6 })),
    removedShoppingListItemIds: items.map((item) => item.entryId),
  })
  const finalResponse = await page.request.get('/api/inventory-items', { headers })
  expect(finalResponse.status()).toBe(200)
  const final = await finalResponse.json()
  expect(final).toHaveLength(3)
  expect(final.every((item: { quantity: number }) => item.quantity === 6)).toBe(true)
  const finalList = await page.request.get('/api/shopping-list-items', { headers })
  expect(finalList.status()).toBe(200)
  expect(await finalList.json()).toEqual([])
})
