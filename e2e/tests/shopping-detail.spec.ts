import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`買い物3列・詳細入力保持・一括購入 ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `shopping_detail_${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const category = await page.request.post('/api/zaiko-categories', { headers, data: { name: '[E2E_TEST]' + '長い分類'.repeat(10) } })
      expect(category.status()).toBe(201)
      const storeName = '[E2E_TEST]' + '長い店名'.repeat(10)
      const store = await page.request.post('/api/stores', { headers, data: { name: storeName } })
      expect(store.status()).toBe(201)
      const categoryId = (await category.json()).id
      const storeId = (await store.json()).id
      const name = '[E2E_TEST]' + '長い品名'.repeat(10)
      const secondName = '[E2E_TEST] testuser_手動品目'
      const first = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId, storeId, quantity: 0, threshold: 5, price: 9999999999 } })
      expect(first.status()).toBe(201)
      const firstId = (await first.json()).id
      const second = await page.request.post('/api/inventory-items', { headers, data: { name: secondName, categoryId, storeId: null, quantity: 1, threshold: 0, price: 0 } })
      expect(second.status()).toBe(201)
      const secondId = (await second.json()).id
      expect((await page.request.post('/api/shopping-list-items', { headers, data: { inventoryItemId: secondId } })).status()).toBe(201)
      await page.goto('/zaiko/shopping')
      const panel = page.getByTestId('shopping-panel')
      const row = panel.getByRole('button', { name: `${name}の詳細`, exact: true })
      const secondRow = panel.getByRole('button', { name: `${secondName}の詳細`, exact: true })
      const dialog = page.getByRole('dialog', { name: '買い物詳細' })
      const close = dialog.getByRole('button', { name: '閉じる' })
      const press = async (locator: typeof row) => width < 400 ? locator.tap() : locator.click()
      const screenshot = async (label: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        for (const cell of await page.locator('.shopping-list-grid > span, [role="dialog"] dd').all()) {
          expect(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        }
        if (process.env.SHOPPING_SCREENSHOT_DIR) {
          await mkdir(process.env.SHOPPING_SCREENSHOT_DIR, { recursive: true })
          await page.screenshot({ path: join(process.env.SHOPPING_SCREENSHOT_DIR, `shopping-${label}-${width}.png`), fullPage: true })
        }
      }
      await expect(row).toBeVisible()
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await expect(row.locator('span')).toHaveCount(3)
      await expect(row.locator('button,input')).toHaveCount(0)
      await screenshot('list')
      for (const index of [0, 1, 2]) {
        await press(row.locator('span').nth(index))
        await expect(dialog).toBeVisible()
        await close.click()
        await expect(row).toBeFocused()
      }
      await row.click({ position: { x: 3, y: 3 } })
      await expect(dialog.getByText('9,999,999,999円')).toBeVisible()
      await expect(dialog.getByText(storeName, { exact: true })).toBeVisible()
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: `${name}の購入個数を増やす` })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
      await screenshot('detail')
      await page.keyboard.press('Escape')
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key)
        await expect(dialog).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      let purchases = 0
      page.on('request', (request) => { if (request.url().endsWith('/shopping-list-items/update') && request.method() === 'POST') purchases++ })
      await press(row)
      await press(dialog.getByRole('button', { name: `${name}の購入個数を減らす` }))
      await expect(dialog.locator('.qty-value')).toHaveText('0')
      await press(dialog.getByRole('button', { name: `${name}の購入個数を増やす` }))
      await close.click()
      await press(secondRow)
      await expect(dialog.getByText('なし', { exact: true })).toBeVisible()
      await expect(dialog.getByText('0円', { exact: true })).toBeVisible()
      await press(dialog.getByRole('button', { name: `${secondName}の購入個数を増やす` }))
      await close.click()
      await panel.getByLabel('並び替え').selectOption('name')
      const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
      await tabs.getByRole('link', { name: '在庫一覧' }).click()
      await tabs.getByRole('link', { name: '買い物リスト' }).click()
      await expect(row.locator('span').last()).toHaveText('1')
      await expect(secondRow.locator('span').last()).toHaveText('1')
      expect(purchases).toBe(0)
      await panel.getByRole('button', { name: '更新', exact: true }).click()
      await expect(secondRow).toHaveCount(0)
      await expect(row.locator('span').last()).toHaveText('0')
      expect(purchases).toBe(1)
      const inventoryResponse = await page.request.get('/api/inventory-items', { headers })
      const inventory = await inventoryResponse.json()
      expect(inventory.find((item: { id: number }) => item.id === firstId).quantity).toBe(1)
      expect(inventory.find((item: { id: number }) => item.id === secondId).quantity).toBe(2)
      await press(row)
      await press(dialog.getByRole('button', { name: `${name}を削除` }))
      await expect(row).toHaveCount(0)
      await expect(panel.getByRole('button', { name: '品目を手動追加' })).toBeFocused()
      await panel.getByRole('button', { name: '品目を手動追加' }).click()
      await page.getByLabel('追加する品目').selectOption({ label: name })
      await expect(page.getByLabel('値段（円・任意）')).toHaveValue('9999999999')
      await screenshot('manual-add')
    } finally { await context.close() }
  })
}
