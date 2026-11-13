import { test, expect } from './console-guard'
import type { Locator } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

async function expectContained(control: Locator) {
  const geometry = await control.evaluate(el => {
    const rect = el.getBoundingClientRect()
    const parent = el.parentElement!.getBoundingClientRect()
    return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft - 1)
  expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight + 1)
}

for (const width of [320, 390, 1280]) {
  test.describe(`${width}px 家計簿の日付入力 #526`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('日付・対象月を狭い画面でも隣接操作から分離して入力できる', async ({ page, consoleGuard }, testInfo) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `date_layout_${width}`)
      await page.goto('/kakeibo')
      const month = page.locator('#transaction-month')
      const clear = page.getByRole('button', { name: '検索・月を解除' })
      await month.fill('2026-11')
      await expect(month).toHaveValue('2026-11')
      await expectContained(month)
      if (width <= 480) {
        expect.soft((await clear.boundingBox())!.y).toBeGreaterThanOrEqual((await month.boundingBox())!.y + (await month.boundingBox())!.height)
      }
      await page.locator('.transaction-filters').evaluate(el => el.scrollIntoView({ block: 'center' }))
      await page.locator('.transaction-filters').screenshot({ path: testInfo.outputPath(`filters-${width}.png`) })
      await clear.click()
      await expect(month).toHaveValue('')
      await page.getByRole('button', { name: '収支を登録', exact: true }).click()
      const modal = page.getByTestId('transaction-modal')
      for (const kind of ['支出', '収入'] as const) {
        await modal.getByRole('tab', { name: kind, exact: true }).click()
        const date = modal.locator('#tx-date')
        const amount = modal.locator('#tx-amount')
        await date.fill('2026-11-13')
        await amount.fill('1234')
        await expect(date).toHaveValue('2026-11-13')
        await expect(amount).toHaveValue('1234')
        await expectContained(date)
        await expectContained(amount)
        const d = (await date.boundingBox())!
        const a = (await amount.boundingBox())!
        if (width <= 480) expect.soft(a.y).toBeGreaterThanOrEqual(d.y + d.height)
        else expect(a.x).toBeGreaterThanOrEqual(d.x + d.width)
        expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      }
      await page.screenshot({ path: testInfo.outputPath(`modal-${width}.png`), fullPage: true })
    })
  })
}
