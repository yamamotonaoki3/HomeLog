import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`値段APIの互換性・共有・購入後保持と既存画面幅 ${width}px`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 900 })
    await setupUserWithHousehold(page, `price_api_${width}`)
    const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    expect(token).toBeTruthy()
    const headers = { Authorization: `Bearer ${token}` }
    // Vite経由ではなく、実行中のローカルWorkers APIへ直接要求する。
    const endpoint = (path: string) => `http://localhost:8787/api/${path}`
    const post = (path: string, data: unknown) => page.request.post(endpoint(path), { headers, data })
    const get = async (path: string) => {
      const response = await page.request.get(endpoint(path), { headers })
      expect(response.status()).toBe(200)
      return response.json()
    }
    const categoryResponse = await post('zaiko-categories', { name: '[E2E_TEST] price category' })
    expect(categoryResponse.status()).toBe(201)
    const categoryId = (await categoryResponse.json()).id
    const body = { name: '[E2E_TEST] 値段保持品目', categoryId, storeId: null, quantity: 2, threshold: 1 }
    const created = await post('inventory-items', { ...body, price: 1280 })
    expect(created.status()).toBe(201)
    const item = await created.json()
    expect(item.price).toBe(1280)
    const legacy = await post('inventory-items', { ...body, name: '[E2E_TEST] 未入力互換' })
    expect(legacy.status()).toBe(201)
    expect((await legacy.json()).price).toBeNull()
    const added = await post('shopping-list-items', { inventoryItemId: item.id, price: 980 })
    expect(added.status()).toBe(201)
    const entry = await added.json()
    expect(entry.price).toBe(980)
    expect((await get('inventory-items')).find((row: { id: number }) => row.id === item.id).price).toBe(980)
    expect((await get('shopping-list-items'))[0].price).toBe(980)
    expect((await post('shopping-list-items', { inventoryItemId: item.id, price: 1 })).status()).toBe(400)
    const purchased = await post('shopping-list-items/update', { items: [{ id: entry.id, purchasedQuantity: 1 }] })
    expect(purchased.status()).toBe(200)
    expect(await get('shopping-list-items')).toEqual([])
    expect((await get('inventory-items')).find((row: { id: number }) => row.id === item.id)).toMatchObject({ quantity: 3, price: 980 })
    expect((await page.request.patch(endpoint(`inventory-items/${item.id}/quantity`), { headers, data: { delta: -3 } })).status()).toBe(200)
    expect((await get('shopping-list-items'))[0]).toMatchObject({ inventoryItemId: item.id, price: 980, isManual: false })
    const patch = async (extra: object) => {
      const response = await page.request.patch(endpoint(`inventory-items/${item.id}`), { headers, data: { ...body, ...extra } })
      expect(response.status()).toBe(200)
      return response.json()
    }
    expect((await patch({})).price).toBe(980)
    expect((await patch({ price: 0 })).price).toBe(0)
    expect((await get('shopping-list-items'))[0].price).toBe(0)
    expect((await patch({ price: null })).price).toBeNull()
    expect((await get('shopping-list-items'))[0].price).toBeNull()
    for (const [path, panel, label] of [['/zaiko', 'inventory-panel', 'inventory'], ['/zaiko/shopping', 'shopping-panel', 'shopping']]) {
      await page.goto(path)
      await expect(page.getByTestId(panel).getByRole('row').filter({ hasText: body.name })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      if (panel === 'shopping-panel') {
        const scroll = page.getByRole('region', { name: '買い物リスト一覧' })
        await scroll.focus()
        await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth })
        const remove = scroll.getByRole('button', { name: `${body.name}を削除`, exact: true })
        await expect(remove).toBeInViewport()
        await expect(remove).toBeEnabled()
        const row = scroll.getByRole('row').filter({ hasText: body.name })
        await expect(row.locator('.qty-value')).toHaveText('0')
      }
      await page.screenshot({ path: test.info().outputPath(`${label}-${width}.png`), fullPage: true })
    }
  })
}
