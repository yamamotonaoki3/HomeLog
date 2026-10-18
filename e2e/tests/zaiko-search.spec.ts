import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function expectFits(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const box of await Promise.all((await page.getByRole('searchbox', { name: 'キーワード検索' }).all()).map((el) => el.boundingBox()))) {
    if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width) }
  }
}

for (const width of [1280, 390, 320]) {
  test(`${width}px 在庫一覧・買い物リストをキーワードで絞り込める (#315)`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await setupUserWithHousehold(page, `zaiko_search_${width}`)
    const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    const headers = { Authorization: `Bearer ${token}` }
    const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
    for (const [name, quantity] of [['[E2E_TEST] 牛乳', 0], ['[E2E_TEST] Butter', 0], ['[E2E_TEST] お米', 5]] as const) {
      const res = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: categories[0].id, storeId: null, quantity, threshold: 1 } })
      expect(res.status()).toBe(201)
    }
    await page.goto('/zaiko')
    const inventory = page.getByTestId('inventory-panel')
    const search = inventory.getByRole('searchbox', { name: 'キーワード検索' })
    await search.fill('ｂｕｔｔｅｒ')
    await expect(inventory.getByRole('button', { name: '[E2E_TEST] Butterの詳細' })).toBeVisible()
    await expect(inventory.getByRole('button', { name: '[E2E_TEST] お米の詳細' })).toHaveCount(0)
    await expectFits(page, width)
    const dir = process.env.ZAIKO_SEARCH_SCREENSHOT_DIR
    if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `inventory-${width}.png`) }) }
    await search.fill('チーズ')
    await expect(inventory.getByText('該当する品目がありません')).toBeVisible()

    await page.getByRole('navigation', { name: '在庫管理関連機能' }).getByRole('link', { name: '買い物リスト' }).click()
    const shopping = page.getByTestId('shopping-panel')
    await shopping.getByRole('searchbox', { name: 'キーワード検索' }).fill('牛乳')
    await expect(shopping.getByRole('button', { name: '[E2E_TEST] 牛乳の詳細' })).toBeVisible()
    await expect(shopping.getByRole('button', { name: '[E2E_TEST] Butterの詳細' })).toHaveCount(0)
    await expectFits(page, width)
    if (dir) await page.screenshot({ path: join(dir, `shopping-${width}.png`) })
  })
}
