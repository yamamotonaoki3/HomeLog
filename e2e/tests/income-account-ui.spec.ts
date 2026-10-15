import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('.transaction-modal, .transaction-modal select, .transaction-detail-modal, .transaction-detail-modal dd').all()) {
    const box = await element.boundingBox()
    if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width) }
  }
}
for (const width of [1280, 390, 320]) {
  test.describe(`収入口座UI #245 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 500 })
    test('UI登録・残高・履歴・削除後詳細・長文と上限金額', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `income_ui_${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const post = async (path: string, data: unknown) => {
        const response = await page.request.post(`/api/${path}`, { headers, data })
        expect(response.status()).toBe(201)
        return response.json()
      }
      const shots = process.env.INCOME_UI_SCREENSHOT_DIR
      if (shots) await mkdir(shots, { recursive: true })
      const shot = async (label: string) => { await fits(page); if (shots) await page.screenshot({ path: join(shots, `${label}-${width}.png`), fullPage: true }) }
      await page.goto('/kakeibo')
      await page.getByRole('button', { name: '登録', exact: true }).click()
      const modal = page.getByTestId('transaction-modal')
      await modal.getByRole('tab', { name: '収入' }).click()
      await expect(modal.getByRole('link', { name: '口座管理へ' })).toHaveAttribute('href', '/accounts')
      await expect(modal.getByRole('button', { name: '登録', exact: true })).toBeDisabled()
      await modal.getByRole('button', { name: 'キャンセル' }).click()
      const name = '[E2E_TEST]' + '入金口座'.repeat(10)
      const account = await post('accounts', { name, type: 'bank', balance: 10000 })
      const other = await post('accounts', { name: '[E2E_TEST]別口座', type: 'bank', balance: 300 })
      const card = await post('cards', { accountId: account.id, name: '[E2E_TEST]子カード', cardType: 'charge' })
      await page.reload()
      await page.getByRole('button', { name: '登録', exact: true }).click()
      await modal.getByRole('tab', { name: '収入' }).click()
      await modal.getByLabel('金額').fill('2500')
      await modal.getByLabel('収入内容').fill('[E2E_TEST]給与')
      let posts = 0
      page.on('request', (request) => { if (request.url().endsWith('/api/incomes') && request.method() === 'POST') posts++ })
      await modal.getByRole('button', { name: '登録', exact: true }).click()
      expect(posts).toBe(0)
      const select = modal.getByLabel('入金先口座（必須）')
      await expect(select).toHaveValue('')
      await expect(select.getByRole('option')).toHaveCount(3)
      await expect(select.getByRole('option', { name: '[E2E_TEST]子カード' })).toHaveCount(0)
      await select.focus()
      await select.press('ArrowDown')
      await select.press('Enter')
      await expect(select).toHaveValue(String(account.id))
      const savedResponse = page.waitForResponse((r) => r.url().endsWith('/api/incomes') && r.request().method() === 'POST')
      await modal.getByRole('button', { name: '登録', exact: true }).click()
      const saved = await (await savedResponse).json()
      expect(saved).toMatchObject({ accountId: account.id, accountName: name, amount: 2500 })
      await expect(modal).toBeHidden()
      expect(posts).toBe(1)
      await expect(page.getByTestId('monthly-summary')).toContainText('今月収入：2500円')
      const getAccounts = async () => (await page.request.get('/api/accounts', { headers })).json()
      expect(await getAccounts()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: account.id, balance: 12500, cards: [expect.objectContaining({ id: card.id, balance: 0 })] }),
        expect.objectContaining({ id: other.id, balance: 300 }),
      ]))
      await page.getByRole('button', { name: '収入：[E2E_TEST]給与の詳細', exact: true }).click()
      const detail = page.getByRole('dialog', { name: '収入詳細' })
      await expect(detail).toContainText(name)
      await detail.getByRole('button', { name: '閉じる' }).click()
      await page.goto('/accounts')
      const row = page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) })
      await expect(row.locator('td').nth(2)).toHaveText('12500円')
      await row.getByRole('button', { name, exact: true }).click()
      await expect(page.getByTestId('account-transactions-modal')).toContainText('[E2E_TEST]給与')
      expect(await (await page.request.get(`/api/accounts/${account.id}/transactions`, { headers })).json()).toMatchObject({ currentBalance: 12500, transactions: [expect.objectContaining({ id: saved.id, amount: 2500, balanceAfter: 12500 })] })
      expect((await page.request.delete(`/api/accounts/${account.id}`, { headers })).status()).toBe(204)
      await page.goto('/kakeibo')
      await page.getByRole('button', { name: '収入：[E2E_TEST]給与の詳細', exact: true }).click()
      await expect(detail).toContainText(name)
      await shot('income-deleted-detail')
      await detail.getByRole('button', { name: '閉じる' }).click()
      await page.getByRole('button', { name: '登録', exact: true }).click()
      await modal.getByRole('tab', { name: '収入' }).click()
      await expect(select.getByRole('option', { name, exact: true })).toHaveCount(0)
      await modal.getByRole('button', { name: 'キャンセル' }).click()
      const longName = name.slice(0, -1) + '長'
      const longAccount = await post('accounts', { name: longName, type: 'bank', balance: 0 })
      await page.reload()
      await page.getByRole('button', { name: '登録', exact: true }).click()
      await modal.getByRole('tab', { name: '収入' }).click()
      await select.selectOption(String(longAccount.id))
      await modal.getByLabel('金額').fill('9999999999')
      const content = '[E2E_TEST]' + '長文収入'.repeat(22)
      await modal.getByLabel('収入内容').fill(content)
      await modal.getByLabel('メモ').fill('[E2E_TEST]' + 'M'.repeat(240))
      await shot('income-register')
      await modal.getByRole('button', { name: '登録', exact: true }).scrollIntoViewIfNeeded()
      await expect(modal.getByRole('button', { name: 'キャンセル' })).toBeInViewport()
      await modal.getByRole('button', { name: '登録', exact: true }).click()
      await expect(modal).toBeHidden()
      await page.getByRole('button', { name: `収入：${content}の詳細`, exact: true }).click()
      await expect(detail).toContainText('+9,999,999,999円')
      await expect(detail).toContainText(longName)
      await shot('income-detail')
      await detail.getByRole('button', { name: '閉じる' }).click()
      const settlementAccount = await post('accounts', { name: '[E2E_TEST]精算口座', type: 'bank', balance: 0 })
      const categoriesResponse = await page.request.get('/api/kakeibo-categories', { headers })
      const categories = await categoriesResponse.json()
      const expense = await post('expenses', { expenseDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), amount: 1000, purpose: '[E2E_TEST]精算確認', categoryId: categories[0].id, includeInHouseholdTotal: false, splitInputType: 'ratio', splits: [{ debtorExternalName: 'e2euser_external', ratio: 50 }] })
      const splits = await (await page.request.get('/api/expense-splits', { headers })).json()
      const split = splits.find((s: { expenseId: number }) => s.expenseId === expense.id)
      expect(split).toBeTruthy()
      expect((await page.request.patch(`/api/expense-splits/${split.id}/settle-self`, { headers, data: { accountId: settlementAccount.id } })).status()).toBe(200)
      expect((await page.request.delete(`/api/accounts/${settlementAccount.id}`, { headers })).status()).toBe(204)
      const incomes = await (await page.request.get('/api/incomes', { headers })).json()
      const settlement = incomes.find((income: { accountId: number }) => income.accountId === settlementAccount.id)
      expect(settlement).toMatchObject({ accountName: '[E2E_TEST]精算口座', amount: 500 })
      await page.reload()
      await page.getByRole('button', { name: `収入：${settlement.content}の詳細`, exact: true }).filter({ hasText: '+500円' }).click()
      await expect(detail).toContainText('[E2E_TEST]精算口座')
      await shot('income-settlement-deleted-detail')
    })
  })
}
