import { expectActionTargets44 } from './support/list-row'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { openInventoryDetails, setupUserWithHousehold } from './support/flows'

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
      const edit = page.getByRole('dialog', { name: '在庫の詳細編集' })
      const operations = page.getByRole('region', { name: name + 'の数量変更', exact: true })
      const detailTrigger = page.getByRole('button', { name: name + 'の詳細を編集', exact: true })
      for (const cell of await row.locator(':scope > span:visible').all()) {
        if (width < 400) await cell.tap()
        else await cell.click()
        await expect(row).toHaveAttribute('aria-expanded', 'true')
        await expect(operations).toBeVisible()
        await expect(edit).toHaveCount(0)
        await detailTrigger.scrollIntoViewIfNeeded()
        const beforeOpen = await page.evaluate(() => ({ y: window.scrollY, position: document.body.style.position }))
        await detailTrigger.click()
        await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
        await expect(edit.getByLabel('品名', { exact: true })).toHaveValue(name)
        expect(await page.evaluate(() => document.body.style.position)).toBe('fixed')
        for (const input of await edit.locator('input:visible, select:visible, textarea:visible').all()) {
          expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
        }
        await page.keyboard.press('Escape')
        await expect(detailTrigger).toBeFocused()
        await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe(beforeOpen.position)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeOpen.y)
        await row.click()
        await expect(row).toHaveAttribute('aria-expanded', 'false')
        await expect(row).toBeFocused()
      }
      for (const key of ['Enter', 'Space']) {
        await row.press(key)
        await expect(operations).toBeVisible()
        await detailTrigger.press('Enter')
        await expect(edit).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(detailTrigger).toBeFocused()
        await row.press(key)
        await expect(row).toHaveAttribute('aria-expanded', 'false')
        await expect(row).toBeFocused()
      }
      if (width === 390) {
        await page.setViewportSize({ width, height: 420 })
        await openInventoryDetails(page, row)
        await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
        const autoToggle = edit.getByRole('switch', { name: '毎日の自動消費' })
        if (await autoToggle.getAttribute('aria-checked') !== 'true') await autoToggle.click()
        await edit.getByLabel('品名', { exact: true }).focus()
        expect(await edit.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
        const consumption = edit.getByLabel('1日の消費量（任意）')
        const cancel = edit.getByRole('button', { name: 'キャンセル' })
        const initialModalBox = (await edit.boundingBox())!
        const initialCancelBox = (await cancel.boundingBox())!
        // 下部が実際に見切れる長いフォームで、Tabだけでスクロールを追従させる。
        expect(initialCancelBox.y).toBeGreaterThan(initialModalBox.y + initialModalBox.height)
        for (const target of [consumption, cancel]) {
          for (let tabs = 0; tabs < 30; tabs++) {
            if (await target.evaluate(el => el === document.activeElement)) break
            await page.keyboard.press('Tab')
          }
          await expect(target).toBeFocused()
          // toBeVisibleだけではoverflowで切れた要素も通るため、実座標で検証する。
          // boundingBox/evaluateは読み取りのみ。focus/click/scrollIntoViewは使わない。
          await expect.poll(async () => {
            const modalBox = (await edit.boundingBox())!
            const targetBox = (await target.boundingBox())!
            return {
              top: targetBox.y >= Math.max(0, modalBox.y) - 1,
              bottom: targetBox.y + targetBox.height <= Math.min(420, modalBox.y + modalBox.height) + 1,
            }
          }).toEqual({ top: true, bottom: true })
        }
        await page.keyboard.press('Escape')
        await expect(detailTrigger).toBeFocused()
        await page.setViewportSize({ width, height: 900 })
      }
      if (await row.getAttribute('aria-expanded') === 'true') await row.click()
      await row.click({ position: { x: 3, y: 3 } })
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await openInventoryDetails(page, row)
      await expectActionTargets44(edit)
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
      expect(plusBox.width).toBeGreaterThanOrEqual(44)
      expect(plusBox.height).toBeGreaterThanOrEqual(44)
      expect(minusBox.width).toBeGreaterThanOrEqual(44)
      expect(minusBox.height).toBeGreaterThanOrEqual(44)
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
      await expect(detailTrigger).toBeFocused()
      await openInventoryDetails(page, row)
      await expect(edit.getByLabel('値段（円・任意）')).toHaveValue('9999999999')
      await expect(edit.locator('.qty-value')).toHaveText('1.9')
      await edit.getByLabel('値段（円・任意）').fill('0')
      // 末尾の操作は「キャンセル／保存」の順(#469)。最後の「保存」から先頭へ循環する。
      const save = edit.getByRole('button', { name: '保存', exact: true })
      await edit.getByRole('button', { name: 'キャンセル' }).focus()
      await page.keyboard.press('Tab')
      await expect(save).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(edit.getByLabel('品名', { exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(save).toBeFocused()
      await save.click()
      await expect(edit).toBeHidden()
      await expect(detailTrigger).toBeFocused()
      await page.reload()
      await openInventoryDetails(page, row)
      await expect(edit.getByLabel('値段（円・任意）')).toHaveValue('0')
      await expect(edit.locator('.qty-value')).toHaveText('1.9')
      await page.locator('.modal-overlay').click({ position: { x: 1, y: 1 } })
      await expect(edit).toBeHidden()
      await expect(detailTrigger).toBeFocused()
    } finally { await context.close() }
  })
}
