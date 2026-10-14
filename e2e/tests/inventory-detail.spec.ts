import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`在庫の行全域・詳細・編集・キーボード ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `inventory_detail_${width}`)
      await page.goto('/zaiko')
      const name = '[E2E_TEST]' + '長い品名'.repeat(10)
      const shots = process.env.INVENTORY_SCREENSHOT_DIR
      const screenshot = async (label: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: join(shots, `inventory-${label}-${width}.png`), fullPage: true }) }
      }
      const press = async (locator: ReturnType<typeof page.getByRole>) => width < 400 ? locator.tap() : locator.click()
      await page.getByRole('button', { name: '在庫を登録' }).click()
      await page.getByLabel('品名', { exact: true }).fill(name)
      await page.getByLabel('値段（円・任意）').fill('9999999999')
      await screenshot('register')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await expect(row).toBeVisible()
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      const box = await row.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      await screenshot('list')
      const detail = page.getByRole('dialog', { name: '在庫詳細' })
      for (const index of [0, 1, 2]) {
        await press(row.locator('span').nth(index))
        await expect(detail).toBeVisible()
        await expect(detail.getByText(name, { exact: true })).toBeVisible()
        await detail.getByRole('button', { name: '閉じる' }).click()
        await expect(row).toBeFocused()
      }
      await row.click({ position: { x: 3, y: 3 } })
      await expect(detail).toBeVisible()
      await expect(detail.getByText('9,999,999,999円')).toBeVisible()
      await expect(detail.getByText('なし', { exact: true })).toBeVisible()
      const close = detail.getByRole('button', { name: '閉じる' })
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      const plus = detail.getByRole('button', { name: `${name}を増やす` })
      await expect(plus).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
      await screenshot('detail')
      let release!: () => void
      const blocked = new Promise<void>((resolve) => { release = resolve })
      const quantityPath = '**/api/inventory-items/*/quantity'
      await page.route(quantityPath, async (route) => { await blocked; await route.continue() })
      const response = page.waitForResponse((result) => result.url().includes('/quantity') && result.request().method() === 'PATCH')
      try {
        await plus.focus()
        await page.keyboard.press('Enter')
        await expect(plus).toBeDisabled()
        await page.keyboard.press('Tab')
        await expect(close).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(detail).toBeHidden()
        await expect(row).toBeFocused()
      } finally { release() }
      await response
      await page.unroute(quantityPath)
      await press(row)
      await expect(plus).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(row).toBeFocused()
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key)
        await expect(detail).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none')
      await page.getByRole('heading', { name: '在庫一覧', exact: true }).click()
      await page.mouse.move(0, 0)
      const normalBackground = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
      await row.hover()
      expect(await row.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(normalBackground)
      await press(row)
      await press(detail.getByRole('button', { name: `${name}を編集` }))
      await expect(detail).toBeHidden()
      const edit = page.getByRole('dialog', { name: '在庫を編集' })
      await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
      await expect(edit.getByLabel('在庫個数', { exact: true })).toBeDisabled()
      await screenshot('edit')
      await edit.getByLabel('値段（円・任意）').fill('0')
      await edit.getByRole('button', { name: 'キャンセル' }).click()
      await expect(detail.getByText('9,999,999,999円')).toBeVisible()
      await press(detail.getByRole('button', { name: `${name}を編集` }))
      await edit.getByLabel('値段（円・任意）').fill('0')
      await edit.getByRole('button', { name: '保存' }).click()
      await expect(detail.getByText('0円', { exact: true })).toBeVisible()
      await detail.getByText(name, { exact: true }).click()
      await expect(detail).toBeVisible()
      await page.locator('.modal-overlay').click({ position: { x: 1, y: 1 } })
      await expect(detail).toBeHidden()
      await expect(row).toBeFocused()
      const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
      await tabs.getByRole('link', { name: '買い物リスト' }).click()
      await tabs.getByRole('link', { name: '在庫一覧' }).click()
      await press(row)
      await expect(detail).toBeVisible()
      await page.goBack()
      await expect(page.getByTestId('shopping-panel')).toBeVisible()
      const shoppingAction = page.getByRole('button', { name: '品目を手動追加' })
      await shoppingAction.focus()
      await page.keyboard.press('Tab')
      await expect(shoppingAction).not.toBeFocused()
      expect(await page.evaluate(() => document.activeElement?.closest('[hidden]') == null)).toBe(true)
    } finally { await context.close() }
  })
}
