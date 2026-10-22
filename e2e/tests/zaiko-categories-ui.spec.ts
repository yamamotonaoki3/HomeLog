import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`在庫の登録・編集内でカテゴリー追加・重複・入力保持 ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      consoleGuard.allow({ url: /\/api\/zaiko-categories$/, message: /409/ })
      await setupUserWithHousehold(page, `inline_category_${width}`)
      await page.goto('/zaiko')
      const name = '[E2E_TEST] testuser_カテゴリー品目'
      const categoryName = '[E2E_TEST]' + '長い分類'.repeat(10)
      const shots = process.env.CATEGORY_SCREENSHOT_DIR
      const fits = async (label: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        for (const element of await page.locator('.inventory-modal, .inventory-category-form').all()) {
          expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        }
        if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: join(shots, `category-${label}-${width}.png`), fullPage: true }) }
      }
      await page.getByRole('button', { name: '在庫を登録' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('品名', { exact: true }).fill(name)
      await dialog.getByLabel('値段（円・任意）').fill('1280')
      await dialog.getByLabel('在庫個数', { exact: true }).fill('2')
      await dialog.getByLabel('1日の消費量（任意）').fill('0.2')
      await dialog.getByRole('button', { name: '＋カテゴリーを登録' }).click()
      const categoryInput = dialog.getByLabel('カテゴリー名', { exact: true })
      await expect(categoryInput).toBeFocused()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await categoryInput.fill('野菜')
      await dialog.getByRole('button', { name: 'カテゴリーを追加', exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText('同じ名前のカテゴリーが既に登録されています')
      await expect(categoryInput).toHaveValue('野菜')
      await expect(dialog.getByLabel('品名', { exact: true })).toHaveValue(name)
      await fits('duplicate')
      await categoryInput.fill(categoryName)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      let posts = 0
      const path = '**/api/zaiko-categories'
      await page.route(path, async route => {
        if (route.request().method() !== 'POST') { await route.continue(); return }
        posts++
        await gate
        await route.continue()
      })
      try {
        await dialog.getByRole('button', { name: 'カテゴリーを追加', exact: true }).click()
        await expect(dialog.getByRole('button', { name: 'カテゴリーを追加', exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeDisabled()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeVisible()
      } finally { release() }
      await expect(categoryInput).toBeHidden()
      await page.unroute(path)
      expect(posts).toBe(1)
      const selection = dialog.getByLabel('カテゴリー', { exact: true })
      await expect(selection.locator('option:checked')).toHaveText(categoryName)
      await expect(selection).toBeFocused()
      await expect(dialog.getByLabel('値段（円・任意）')).toHaveValue('1280')
      await expect(dialog.getByLabel('1日の消費量（任意）')).toHaveValue('0.2')
      await fits('selected')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toBeHidden()
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await expect(row).toBeVisible()
      await page.reload()
      await row.click()
      await expect(selection.locator('option:checked')).toHaveText(categoryName)
      await expect(dialog.getByLabel('値段（円・任意）')).toHaveValue('1280')
      await expect(dialog.locator('.qty-value')).toHaveText('2.0')
      await dialog.getByLabel('品名', { exact: true }).fill('[E2E_TEST] 保存しない名前')
      await dialog.getByRole('button', { name: '＋カテゴリーを登録' }).click()
      await categoryInput.fill('[E2E_TEST] 編集で追加')
      await categoryInput.press('Enter')
      await expect(categoryInput).toBeHidden()
      await expect(selection.locator('option:checked')).toHaveText('[E2E_TEST] 編集で追加')
      await expect(dialog.getByLabel('品名', { exact: true })).toHaveValue('[E2E_TEST] 保存しない名前')
      await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
      await expect(row).toBeFocused()
      await page.reload()
      await row.click()
      await expect(selection.locator('option:checked')).toHaveText(categoryName)
      await selection.selectOption({ label: '[E2E_TEST] 編集で追加' })
      await dialog.getByRole('button', { name: '＋カテゴリーを登録' }).click()
      await categoryInput.fill('[E2E_TEST] 取りやめ')
      await dialog.getByRole('button', { name: '追加をやめる' }).click()
      await expect(dialog.getByRole('button', { name: '＋カテゴリーを登録' })).toBeFocused()
      await expect(selection.locator('option:checked')).toHaveText('[E2E_TEST] 編集で追加')
      await fits('edit')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toBeHidden()
      await page.reload()
      await row.click()
      await expect(selection.locator('option:checked')).toHaveText('[E2E_TEST] 編集で追加')
      await page.keyboard.press('Escape')
      await expect(row).toBeFocused()
    } finally { await context.close() }
  })
}
