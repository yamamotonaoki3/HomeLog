import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('.transaction-list, .transaction-detail-modal, .transaction-detail-modal dd').all()) {
    const box = await element.boundingBox()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    }
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px income account API #244`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 500 })
    test('実Workersで入金・残高・履歴・集計・論理削除を確認する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `income_account_${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const post = async (path: string, data: unknown) => {
        const res = await page.request.post(`/api/${path}`, { headers, data })
        expect(res.status()).toBe(201)
        return res.json()
      }
      const name = '[E2E_TEST]' + '入金口座'.repeat(10)
      const content = '[E2E_TEST]' + '給与'.repeat(40)
      const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
      const account = await post('accounts', { name, type: 'bank', balance: 10000 })
      const categories = await (await page.request.get('/api/income-categories', { headers })).json()
      const payload = { incomeDate: date, amount: 9999999999, content, categoryId: categories[0].id, accountId: account.id }
      const saved = await post('incomes', payload)
      expect(saved.accountId).toBe(account.id)
      for (const accountId of [undefined, null, 99999999]) {
        expect((await page.request.post('/api/incomes', { headers, data: { ...payload, accountId } })).status()).toBe(400)
      }
      expect(await (await page.request.get('/api/incomes', { headers })).json()).toEqual([expect.objectContaining({ id: saved.id, accountId: account.id, accountName: name })])
      expect(await (await page.request.get('/api/accounts', { headers })).json()).toEqual([expect.objectContaining({ id: account.id, balance: 10000009999 })])
      expect(await (await page.request.get(`/api/accounts/${account.id}/transactions`, { headers })).json()).toMatchObject({
        currentBalance: 10000009999, transactions: [expect.objectContaining({ id: saved.id, type: 'income', amount: payload.amount, balanceAfter: 10000009999 })],
      })
      expect(await (await page.request.get('/api/dashboard/summary', { headers })).json()).toMatchObject({ todayBalance: payload.amount })

      const shots = process.env.INCOME_ACCOUNT_SCREENSHOT_DIR
      if (shots) await mkdir(shots, { recursive: true })
      const shot = async (label: string) => {
        await fits(page)
        if (shots) await page.screenshot({ path: join(shots, `${label}-${width}.png`), fullPage: true })
      }
      await page.goto('/kakeibo')
      await expect(page.getByRole('button', { name: `収入：${content}の詳細`, exact: true })).toContainText('+9,999,999,999円')
      await shot('income-list')
      await page.getByRole('button', { name: `収入：${content}の詳細`, exact: true }).click()
      const detail = page.getByRole('dialog', { name: '収入詳細' })
      await expect(detail).toContainText(name)
      await shot('income-detail')
      await detail.getByRole('button', { name: '閉じる' }).click()
      await page.goto('/accounts')
      await expect(page.getByText(name, { exact: true })).toBeVisible()
      await shot('accounts')
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByTestId('account-transactions-modal')).toContainText(content)
      await shot('account-history')

      expect((await page.request.delete(`/api/accounts/${account.id}`, { headers })).status()).toBe(204)
      expect(await (await page.request.get('/api/accounts', { headers })).json()).toEqual([])
      expect(await (await page.request.get('/api/incomes', { headers })).json()).toEqual([expect.objectContaining({ id: saved.id, accountId: account.id, accountName: name })])
      expect((await page.request.post('/api/incomes', { headers, data: payload })).status()).toBe(400)
      await page.goto('/accounts')
      await expect(page.getByText(name, { exact: true })).toHaveCount(0)
      await shot('accounts-after-delete')
    })
  })
}
