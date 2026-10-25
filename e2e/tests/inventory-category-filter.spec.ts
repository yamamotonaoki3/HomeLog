import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`在庫をカテゴリーと検索で絞り込み、編集後も条件を維持する ${width}px (#369)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `inventory_filter_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
    const vegetable = categories.find((category: { name: string }) => category.name === '野菜')
    const dairy = categories.find((category: { name: string }) => category.name === '乳製品')
    const emptyResponse = await page.request.post('/api/zaiko-categories', { headers, data: { name: '[E2E_TEST]' + '長い分類'.repeat(8) } })
    expect(emptyResponse.status()).toBe(201)
    const emptyCategory = await emptyResponse.json()
    for (const [name, categoryId] of [['[E2E_TEST] にんじん', vegetable.id], ['[E2E_TEST] 小松菜', vegetable.id], ['[E2E_TEST] 牛乳', dairy.id]]) {
      expect((await page.request.post('/api/inventory-items', { headers, data: { name, categoryId, storeId: null, quantity: 3, threshold: 1 } })).status()).toBe(201)
    }
    await page.goto('/zaiko')
    const panel = page.getByTestId('inventory-panel')
    const filter = panel.getByRole('combobox', { name: 'カテゴリーで絞り込み' })
    const rows = panel.getByRole('button', { name: /の詳細$/ })
    await expect(rows).toHaveCount(3)
    await filter.selectOption(String(vegetable.id))
    await expect(rows).toHaveCount(2)
    await panel.getByRole('searchbox', { name: 'キーワード検索' }).fill('ニンジン')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('にんじん')
    await filter.selectOption(String(dairy.id))
    await expect(panel.getByText('該当する品目がありません')).toBeVisible()
    await panel.getByRole('searchbox', { name: 'キーワード検索' }).clear()
    await expect(rows).toHaveCount(1)
    await rows.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('カテゴリー', { exact: true }).selectOption(String(vegetable.id))
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(filter).toHaveValue(String(dairy.id))
    await expect(panel.getByText('該当する品目がありません')).toBeVisible()
    await filter.selectOption(String(emptyCategory.id))
    await expect(panel.getByText('該当する品目がありません')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const shotDir = process.env.INVENTORY_FILTER_SCREENSHOT_DIR
    if (shotDir) {
      await mkdir(shotDir, { recursive: true })
      await page.screenshot({ path: join(shotDir, `inventory-filter-${width}.png`) })
    }
    await filter.selectOption('')
    await expect(rows).toHaveCount(3)
    await filter.selectOption(String(vegetable.id))
    await expect(rows).toHaveCount(3)
  })
}
