import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const selector of ['.kakeibo-page .panel', '.kakeibo-page .toolbar > *', '.transaction-table', '.transaction-table button', '.transaction-detail-modal', '.transaction-detail-modal dd']) {
    for (const element of await page.locator(selector).all()) {
      const rect = await element.boundingBox()
      if (rect) { expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width) }
    }
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px 家計簿の閲覧`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('3列一覧・行操作・長文詳細・精算入金先・横幅・ダーク設定', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'kakeibo_detail_' + width)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const post = async (path: string, data: unknown) => {
        const response = await page.request.post('/api/' + path, { headers, data })
        expect(response.status()).toBe(201)
        return response.json()
      }
      const accountName = 'testuser_' + '口座'.repeat(20)
      const account = await post('accounts', { name: accountName, type: 'bank', balance: 9999999999 })
      const eventName = '[E2E_TEST]' + '旅行'.repeat(20)
      const event = await post('events', { name: eventName, eventDate: '2030-01-15', isAllDay: true, recurrenceType: 'none', notifyEnabled: false, personal: true, showOnDashboard: false })
      const categoriesResponse = await page.request.get('/api/kakeibo-categories', { headers })
      const categories = await categoriesResponse.json()
      const incomeCategoriesResponse = await page.request.get('/api/income-categories', { headers })
      const incomeCategories = await incomeCategoriesResponse.json()
      const purpose = '[E2E_TEST]' + 'A'.repeat(90)
      const memo = '[E2E_TEST]\n' + 'M'.repeat(240)
      const expense = await post('expenses', { expenseDate: '2030-01-15', amount: 9999999999, purpose, categoryId: categories[0].id, memo, includeInHouseholdTotal: true, accountId: account.id, eventId: event.id, splitInputType: 'ratio', splits: [{ debtorExternalName: 'testuser_external', ratio: 1 }] })
      await post('expenses', { expenseDate: '2030-01-14', amount: 1000, purpose: '', categoryId: categories[0].id })
      const incomeContent = '[E2E_TEST]' + '収入'.repeat(45)
      const ordinaryIncome = await post('incomes', { incomeDate: '2030-01-16', amount: 1000, content: incomeContent, categoryId: incomeCategories[0].id, memo })
      expect(ordinaryIncome.accountId).toBeNull()
      const splitsResponse = await page.request.get('/api/expense-splits', { headers })
      const splits = await splitsResponse.json()
      const split = splits.find((item: { expenseId: number }) => item.expenseId === expense.id)
      const settleResponse = await page.request.patch(`/api/expense-splits/${split.id}/settle-self`, { headers, data: { accountId: account.id } })
      expect(settleResponse.ok()).toBe(true)
      const incomesResponse = await page.request.get('/api/incomes', { headers })
      const incomes = await incomesResponse.json()
      expect(incomes.find((item: { content: string }) => item.content === purpose).accountId).toBe(account.id)
      await page.goto('/kakeibo')
      const panel = page.getByTestId('transaction-panel')
      await expect(panel.getByRole('columnheader')).toHaveText(['日付', '内容', '金額'])
      const expenseRow = panel.getByRole('row').filter({ hasText: purpose }).filter({ hasText: '-9,999,999,999円' })
      await expect(expenseRow).toBeVisible()
      await expect(panel.getByRole('row').filter({ hasText: incomeContent })).toContainText('+1,000円')
      await fits(page)
      const shots = process.env.ISSUE_214_SHOTS_DIR
      if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: join(shots, `kakeibo-${width}.png`), fullPage: true }) }
      const trigger = expenseRow.getByRole('button')
      if (width === 1280) { await trigger.focus(); await trigger.press('Enter') }
      else await expenseRow.getByRole('cell').first().tap()
      const detail = page.getByRole('dialog', { name: '支出詳細' })
      await expect(detail.getByRole('heading')).toBeInViewport()
      expect(await detail.locator('.transaction-detail-modal').evaluate((element) => element.scrollTop)).toBe(0)
      for (const value of [purpose, accountName, eventName, 'testuser_external（世帯外）', '精算済み', '1% / 99,999,999円']) await expect(detail).toContainText(value)
      await expect(detail.locator('.transaction-detail-memo')).toHaveText(memo)
      await expect(detail.getByRole('button', { name: /編集|削除/ })).toHaveCount(0)
      await fits(page)
      if (shots) await page.screenshot({ path: join(shots, `expense-detail-${width}.png`) })
      await detail.getByRole('heading').click()
      await expect(detail).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await trigger.press('Space')
      await detail.getByRole('button', { name: '閉じる' }).click()
      if (width === 1280) await expenseRow.getByRole('cell').last().click()
      else await expenseRow.getByRole('cell').last().tap()
      await detail.click({ position: { x: 2, y: 2 } })
      await expect(detail).toBeHidden()
      for (const mode of ['expense', 'income', 'all']) {
        await panel.getByLabel('種別絞り込み').selectOption(mode)
        await expect(panel.getByRole('columnheader')).toHaveText(['日付', '内容', '金額'])
        await fits(page)
      }
      await panel.getByRole('button', { name: '内容なし', exact: true }).click()
      await expect(detail).toContainText('内容なし')
      await detail.getByRole('button', { name: '閉じる' }).click()
      await panel.getByRole('button', { name: incomeContent, exact: true }).click()
      const incomeDetail = page.getByRole('dialog', { name: '収入詳細' })
      await expect(incomeDetail.locator('dt').filter({ hasText: /世帯合計対象|割り勘内訳/ })).toHaveCount(0)
      await expect(incomeDetail.locator('dt').filter({ hasText: /^口座$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('なし')
      await fits(page)
      await incomeDetail.getByRole('button', { name: '閉じる' }).click()
      await panel.getByRole('row').filter({ hasText: purpose }).filter({ hasText: '+' }).getByRole('button').click()
      await expect(incomeDetail).toContainText(accountName)
      await fits(page)
      if (shots) await page.screenshot({ path: join(shots, `income-detail-${width}.png`) })
      await incomeDetail.getByRole('button', { name: '閉じる' }).click()
      await page.emulateMedia({ colorScheme: 'dark' })
      await fits(page)
      for (const className of ['calendar-income', 'calendar-expense']) {
        const contrast = await panel.locator('.' + className).first().evaluate((element) => {
          const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
          const luminance = (values: number[]) => values.map((value) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
          let ancestor: Element | null = element
          let background = 'rgb(255, 255, 255)'
          while (ancestor) { const value = getComputedStyle(ancestor).backgroundColor; if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break }; ancestor = ancestor.parentElement }
          const foregroundLuminance = luminance(rgb(getComputedStyle(element).color))
          const backgroundLuminance = luminance(rgb(background))
          return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        })
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
      if (shots) await page.screenshot({ path: join(shots, `kakeibo-dark-${width}.png`), fullPage: true })
    })
  })
}
