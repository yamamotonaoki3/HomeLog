import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { confirmShoppingPurchase, setupUserWithHousehold } from './support/flows'
import { expectActionTargets44 } from './support/list-row'

for (const width of [1280, 390, 320]) {
  test('買い物店舗別一覧・詳細入力保持・確認購入 ' + width + 'px', async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'shopping_detail_' + width)
      const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
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
      const row = panel.getByRole('button', { name: name + 'の詳細', exact: true })
      const secondRow = panel.getByRole('button', { name: secondName + 'の詳細', exact: true })
      // 行に表示している購入数(#485)。チェック前は予定数、チェック後は実購入数。
      const countGroup = (itemName: string) => panel.getByRole('group', { name: itemName + 'の購入数', exact: true })
      const count = (itemName: string) => countGroup(itemName).getByRole('status')
      const checked = panel.getByRole('checkbox', { name: name + 'を購入済みにする', exact: true })
      const secondChecked = panel.getByRole('checkbox', { name: secondName + 'を購入済みにする', exact: true })
      const dialog = page.getByRole('dialog', { name: '買い物詳細', exact: true })
      const close = dialog.getByRole('button', { name: '閉じる', exact: true })
      const initialClose = dialog.getByRole('button', { name: '買い物詳細を閉じる', exact: true })
      const actual = dialog.getByLabel(name + 'の実購入数', { exact: true })
      const press = async (locator: typeof row) => width < 400 ? locator.tap() : locator.click()
      const screenshot = async (label: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const overflow = await page.locator('.shopping-item-name, .shopping-item-quantities, .shopping-count, [role="dialog"] dd').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth))
        expect(overflow).toBe(false)
        if (process.env.SHOPPING_SCREENSHOT_DIR) {
          await mkdir(process.env.SHOPPING_SCREENSHOT_DIR, { recursive: true })
          await page.screenshot({ path: join(process.env.SHOPPING_SCREENSHOT_DIR, 'shopping-' + label + '-' + width + '.png'), fullPage: true })
        }
      }
      await expect(row).toBeVisible()
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await expect(row.locator(':scope > span')).toHaveCount(2)
      await expect(row.locator('button,input')).toHaveCount(0)
      await expect(row.locator('..').getByRole('checkbox')).toHaveCount(1)
      await expect(panel.getByRole('region', { name: storeName + 'の買い物', exact: true })).toContainText(name)
      await expect(panel.getByRole('region', { name: '店舗未指定の買い物', exact: true })).toContainText(secondName)
      await expectActionTargets44(panel)
      const label = checked.locator('..')
      expect((await label.boundingBox())!.width).toBeGreaterThanOrEqual(44)
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await screenshot('list')
      // #485: 行の－／＋で購入数を変える。押すとチェックが付き、詳細は開かない。通信もしない。
      const plus = countGroup(name).getByRole('button', { name: name + 'の購入数を1増やす', exact: true })
      const minus = countGroup(name).getByRole('button', { name: name + 'の購入数を1減らす', exact: true })
      await expect(count(name)).toHaveText('1')
      for (const control of [minus, plus]) {
        const box = (await control.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      await press(plus)
      await expect(count(name)).toHaveText('2')
      await expect(checked).toBeChecked()
      await expect(dialog).toHaveCount(0)
      await expect(panel.getByText('購入済み 1件', { exact: true })).toBeVisible()
      await screenshot('count')
      await press(minus)
      await press(minus)
      await expect(count(name)).toHaveText('0')
      await expect(minus).toBeDisabled()
      await expect(panel.getByText('購入済み 0件', { exact: true })).toBeVisible()
      await checked.uncheck()
      await expect(count(name)).toHaveText('1')
      for (const index of [0, 1]) {
        await press(row.locator(':scope > span').nth(index))
        await expect(dialog).toBeVisible()
        await close.click()
        await expect(row).toBeFocused()
      }
      await row.click({ position: { x: 3, y: 3 } })
      await expect(dialog.getByText('9,999,999,999円', { exact: true })).toBeVisible()
      await expect(dialog.getByText(storeName, { exact: true })).toBeVisible()
      await expect(initialClose).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByLabel(name + 'の予定数', { exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(initialClose).toBeFocused()
      await expectActionTargets44(dialog)
      await screenshot('detail')
      await page.keyboard.press('Escape')
      for (const key of ['Enter', 'Space']) {
        await row.press(key)
        await expect(dialog).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      let purchases = 0
      let legacyPurchases = 0
      page.on('request', request => {
        if (request.method() !== 'POST') return
        if (request.url().endsWith('/shopping-list-items/purchases')) purchases++
        if (request.url().endsWith('/shopping-list-items/update')) legacyPurchases++
      })
      await checked.check()
      await press(row)
      await expect(actual).toHaveValue('1')
      await actual.fill('0')
      await expect(actual).toHaveValue('0')
      await actual.fill('1')
      await close.click()
      await secondChecked.check()
      await press(secondRow)
      await expect(dialog.getByText('なし', { exact: true })).toBeVisible()
      await expect(dialog.getByText('0円', { exact: true })).toBeVisible()
      await expect(dialog.getByLabel(secondName + 'の実購入数', { exact: true })).toHaveValue('1')
      await close.click()
      await panel.getByLabel('並び替え').selectOption('name')
      const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
      await tabs.getByRole('link', { name: '在庫一覧' }).click()
      await tabs.getByRole('link', { name: '買い物リスト' }).click()
      await expect(checked).toBeChecked()
      await expect(secondChecked).toBeChecked()
      await expect(count(name)).toHaveText('1')
      await expect(count(secondName)).toHaveText('1')
      expect(purchases).toBe(0)
      await confirmShoppingPurchase(page)
      await expect(secondRow).toHaveCount(0)
      await expect(checked).not.toBeChecked()
      await expect(count(name)).toHaveText('1')
      expect(purchases).toBe(1)
      expect(legacyPurchases).toBe(0)
      const inventoryResponse = await page.request.get('/api/inventory-items', { headers })
      expect(inventoryResponse.status()).toBe(200)
      const inventory = await inventoryResponse.json()
      expect(inventory.find((item: { id: number }) => item.id === firstId).quantity).toBe(1)
      expect(inventory.find((item: { id: number }) => item.id === secondId).quantity).toBe(2)
      await press(row)
      await expect(actual).toHaveValue('')
      await expect(actual).toBeDisabled()
      await press(dialog.getByRole('button', { name: name + 'を削除', exact: true }))
      await expect(row).toHaveCount(0)
      await expect(panel.getByRole('button', { name: '品目を追加', exact: true })).toBeFocused()
      await panel.getByRole('button', { name: '品目を追加', exact: true }).click()
      await page.getByLabel('追加する品目').selectOption({ label: name })
      await expect(page.getByLabel('値段（円・任意）')).toHaveValue('9999999999')
      await screenshot('manual-add')
    } finally { await context.close() }
  })
}
