import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// 在庫が閾値以下(#314)で買い物リストへ自動追加される契約を、実行中のWorkers経由で確認する。
test('在庫が閾値ちょうどになると買い物リストに入り、閾値を超えると外れる', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'zaiko_threshold_api')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
  const created = await page.request.post('/api/inventory-items', {
    headers,
    data: { name: '[E2E_TEST] 卵', categoryId: categories[0].id, storeId: null, quantity: 4, threshold: 3 },
  })
  expect(created.status()).toBe(201)
  const item = await created.json()
  const listed = async () => (await (await page.request.get('/api/shopping-list-items', { headers })).json()).some((entry: { inventoryItemId: number }) => entry.inventoryItemId === item.id)
  const change = (delta: number) => page.request.patch(`/api/inventory-items/${item.id}/quantity`, { headers, data: { delta } })

  expect(await listed()).toBe(false)
  expect((await change(-1)).status()).toBe(200)
  expect(await listed()).toBe(true)
  expect((await change(1)).status()).toBe(200)
  expect(await listed()).toBe(false)
  const summary = await (await page.request.get('/api/dashboard/summary', { headers })).json()
  expect(summary.lowStockCount).toBe(0)
})
