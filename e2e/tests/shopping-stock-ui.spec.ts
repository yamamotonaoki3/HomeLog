import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`買い物リストに現在の在庫数が表示され、購入の反映後に更新される ${width}px (#411)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `shopping_stock_ui_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
    const name = '[E2E_TEST] 在庫表示の長い品名ですが折り返して表示されます'
    const created = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: categories[0].id, storeId: null, price: null, quantity: 0.5, threshold: 3 } })
    expect(created.status()).toBe(201)
    const itemId = (await created.json()).id

    await page.goto('/zaiko/shopping')
    const panel = page.getByTestId('shopping-panel')
    await expect(panel.locator('.shopping-list-grid.list-row-heading > span')).toHaveText(['品名', '買う店', '在庫', '購入個数'])
    const row = panel.getByRole('button', { name: `${name}の詳細`, exact: true })
    await expect(row.locator('.shopping-list-stock')).toHaveText('0.5')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // 詳細モーダルにも現在の在庫が出る
    await row.click()
    const dialog = page.getByRole('dialog', { name: '買い物詳細' })
    await expect(dialog.getByText('現在の在庫')).toBeVisible()
    await expect(dialog.locator('dd', { hasText: /^0\.5$/ })).toBeVisible()
    await dialog.getByRole('button', { name: `${name}の購入個数を増やす` }).click()
    await dialog.getByRole('button', { name: '閉じる' }).click()

    // 購入を反映すると、在庫が増えた値になる(閾値超えで買い物リストから外れる前に確認できるよう、閾値以下のまま)
    await panel.getByRole('button', { name: '更新' }).click()
    await expect(page.getByRole('status')).toContainText('在庫に反映しました')
    const inventory = await (await page.request.get('/api/inventory-items', { headers })).json()
    expect(inventory.find((entry: { id: number }) => entry.id === itemId).quantity).toBe(1.5)
    await page.goto('/zaiko')
    await expect(page.getByTestId('inventory-panel').getByRole('button', { name: `${name}の詳細`, exact: true })).toContainText('1.5')
  })
}
