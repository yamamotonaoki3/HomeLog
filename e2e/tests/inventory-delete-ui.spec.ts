import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`在庫一覧の✖から確認ダイアログを経て在庫を削除できる ${width}px (#380)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `inventory_delete_ui_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
    const names = ['[E2E_TEST] 削除する在庫の長い品名ですが折り返して表示されます', '[E2E_TEST] 残す在庫']
    for (const name of names) {
      const res = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: categories[0].id, storeId: null, price: null, quantity: 2, threshold: 1 } })
      expect(res.status()).toBe(201)
    }

    await page.goto('/zaiko')
    const panel = page.getByTestId('inventory-panel')
    const trigger = panel.getByRole('button', { name: `${names[0]}を削除` })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '在庫の削除' })
    await expect(dialog.getByText(/買い物リストの該当項目も一緒に削除されます/)).toBeVisible()
    await expect(page.getByRole('dialog', { name: /在庫詳細/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused()

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)

    // 取消では何も削除されない
    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await (await page.request.get('/api/inventory-items', { headers })).json()).toHaveLength(2)

    await trigger.click()
    await dialog.getByRole('button', { name: '削除する' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status')).toContainText('在庫を削除しました')
    await expect(panel.getByRole('button', { name: `${names[0]}を削除` })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: `${names[1]}の詳細` })).toBeVisible()
    expect(await (await page.request.get('/api/inventory-items', { headers })).json()).toHaveLength(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}
