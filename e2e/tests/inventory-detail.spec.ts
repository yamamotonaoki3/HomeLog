import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`在庫の詳細編集・数量・保存・キャンセル ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `inventory_detail_${width}`)
      await page.goto('/zaiko')
      const name = '[E2E_TEST]' + '長い品名'.repeat(10)
      await page.getByRole('button', { name: '在庫を登録' }).click()
      await page.getByLabel('品名', { exact: true }).fill(name)
      await page.getByLabel('値段（円・任意）').fill('9999999999')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await expect(row).toBeVisible()
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      const edit = page.getByRole('dialog', { name: '在庫詳細・編集' })
      for (const cell of await row.locator('span').all()) {
        if (width < 400) await cell.tap()
        else await cell.click()
        await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
        await expect(edit.getByLabel('品名', { exact: true })).toHaveValue(name)
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      for (const key of ['Enter', 'Space']) {
        await row.press(key)
        await expect(edit).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      await row.click({ position: { x: 3, y: 3 } })
      await edit.getByLabel('値段（円・任意）').fill('0')
      await edit.getByRole('button', { name: `${name}を増やす` }).click()
      await expect(edit.locator('.qty-value')).toHaveText('2.0')
      await expect(edit.getByLabel('値段（円・任意）')).toHaveValue('0')
      await edit.getByRole('group', { name: '増減幅' }).getByRole('button', { name: '0.1', exact: true }).click()
      await edit.getByRole('button', { name: `${name}を減らす` }).click()
      await expect(edit.locator('.qty-value')).toHaveText('1.9')
      const minusBox = (await edit.getByRole('button', { name: `${name}を減らす` }).boundingBox())!
      const valueBox = (await edit.locator('.qty-value').boundingBox())!
      const plusBox = (await edit.getByRole('button', { name: `${name}を増やす` }).boundingBox())!
      const priceFont = await edit.getByLabel('値段（円・任意）').evaluate(el => getComputedStyle(el).fontSize)
      expect(await edit.locator('.qty-value').evaluate(el => getComputedStyle(el).fontSize)).toBe(priceFont)
      expect(valueBox.height).toBeLessThanOrEqual(40)
      expect(plusBox.width).toBeLessThanOrEqual(36)
      const valueBorder = await edit.locator('.qty-value').evaluate(el => getComputedStyle(el).borderStyle)
      expect(valueBorder).toBe('solid')
      expect(await edit.locator('.inventory-quantity-inline').evaluate(el => getComputedStyle(el).borderStyle)).toBe('none')
      expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(plusBox.x)
      expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(minusBox.x)
      expect(plusBox.y + plusBox.height).toBeLessThanOrEqual(minusBox.y)
      expect(Math.abs(minusBox.x - plusBox.x)).toBeLessThan(1)
      const stepBox = (await edit.getByRole('group', { name: '増減幅' }).boundingBox())!
      expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(stepBox.x)
      expect(stepBox.y).toBeLessThan(minusBox.y + minusBox.height)
      expect(stepBox.y + stepBox.height).toBeGreaterThan(minusBox.y)

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(await edit.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const shots = process.env.INVENTORY_SCREENSHOT_DIR
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: join(shots, `inventory-edit-${width}.png`), fullPage: true })
      }
      await edit.getByRole('button', { name: 'キャンセル' }).click()
      await expect(row).toBeFocused()
      await row.click()
      await expect(edit.getByLabel('値段（円・任意）')).toHaveValue('9999999999')
      await expect(edit.locator('.qty-value')).toHaveText('1.9')
      await edit.getByLabel('値段（円・任意）').fill('0')
      const cancel = edit.getByRole('button', { name: 'キャンセル' })
      await cancel.focus()
      await page.keyboard.press('Tab')
      await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(cancel).toBeFocused()
      await edit.getByRole('button', { name: '保存', exact: true }).click()
      await expect(edit).toBeHidden()
      await expect(row).toBeFocused()
      await page.reload()
      await row.click()
      await expect(edit.getByLabel('値段（円・任意）')).toHaveValue('0')
      await expect(edit.locator('.qty-value')).toHaveText('1.9')
      await page.locator('.modal-overlay').click({ position: { x: 1, y: 1 } })
      await expect(edit).toBeHidden()
      await expect(row).toBeFocused()
    } finally { await context.close() }
  })
}
