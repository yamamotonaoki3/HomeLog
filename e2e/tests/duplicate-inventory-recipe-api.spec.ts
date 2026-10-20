import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('在庫の重複は409で保存せず、自分自身の編集とURLなしレシピの複数登録は成功する (#318)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'duplicate_inventory_recipe_api')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const categoriesResponse = await page.request.get('/api/zaiko-categories', { headers })
  expect(categoriesResponse.status()).toBe(200)
  const categories = await categoriesResponse.json()
  const data = { name: '[E2E_TEST] Milk', categoryId: categories[0].id, storeId: null, quantity: 1, threshold: 0 }
  const created = await page.request.post('/api/inventory-items', { headers, data })
  expect(created.status()).toBe(201)
  const item = await created.json()
  const duplicate = await page.request.post('/api/inventory-items', { headers, data: { ...data, name: '　[E2E_TEST] ＭＩＬＫ　' } })
  expect(duplicate.status()).toBe(409)
  expect(await duplicate.json()).toEqual({ code: 'DUPLICATE_INVENTORY_ITEM_NAME', message: '同じ品名の在庫が既に登録されています', details: [] })
  // カタカナとひらがなも同じ品名として扱う(#325)。
  expect((await page.request.post('/api/inventory-items', { headers, data: { ...data, name: '[E2E_TEST] ミルク' } })).status()).toBe(201)
  expect((await page.request.post('/api/inventory-items', { headers, data: { ...data, name: '[E2E_TEST] みるく' } })).status()).toBe(409)
  expect((await page.request.patch(`/api/inventory-items/${item.id}`, { headers, data })).status()).toBe(200)
  const otherResponse = await page.request.post('/api/inventory-items', { headers, data: { ...data, name: '[E2E_TEST] Other' } })
  expect(otherResponse.status()).toBe(201)
  const other = await otherResponse.json()
  const edited = await page.request.patch(`/api/inventory-items/${other.id}`, { headers, data })
  expect(edited.status()).toBe(409)
  expect(await edited.json()).toEqual({ code: 'DUPLICATE_INVENTORY_ITEM_NAME', message: '同じ品名の在庫が既に登録されています', details: [] })
  const listedResponse = await page.request.get('/api/inventory-items', { headers })
  expect(listedResponse.status()).toBe(200)
  const listed = await listedResponse.json()
  expect(listed.find((row: { id: number }) => row.id === other.id).name).toBe('[E2E_TEST] Other')
  for (let i = 0; i < 2; i++) {
    const recipe = await page.request.post('/api/recipes', { headers, data: { title: '[E2E_TEST] 手動レシピ' } })
    expect(recipe.status()).toBe(201)
    expect((await recipe.json()).url).toBeNull()
  }
})
