import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('[role="dialog"] .modal, .modal[role="dialog"], .modal-actions .btn').all()) {
    const rect = await element.boundingBox()
    if (rect) { expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width) }
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px 家計簿の編集・削除`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('詳細から支出を編集・削除し、残高が戻る。請求中の割り勘は編集不可', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'kakeibo_edit_' + width)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const post = async (path: string, data: unknown) => {
        const response = await page.request.post('/api/' + path, { headers, data })
        expect(response.status()).toBe(201)
        return response.json()
      }
      const balance = async (id: number) => {
        const accounts = await (await page.request.get('/api/accounts', { headers })).json()
        return accounts.find((item: { id: number }) => item.id === id).balance
      }
      const account = await post('accounts', { name: '[E2E_TEST] 口座', type: 'bank', balance: 10000 })
      const categories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
      await post('expenses', { expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST] 編集する支出', categoryId: categories[0].id, accountId: account.id })
      const locked = await post('expenses', { expenseDate: '2030-01-14', amount: 2000, purpose: '[E2E_TEST] 請求中の支出', categoryId: categories[0].id, splits: [{ debtorExternalName: 'testuser_external', ratio: 50 }] })
      const split = (await (await page.request.get('/api/expense-splits', { headers })).json()).find((item: { expenseId: number }) => item.expenseId === locked.id)
      await page.request.patch(`/api/expense-splits/${split.id}/request`, { headers })
      expect(await balance(account.id)).toBe(9000)

      await page.goto('/kakeibo')
      const panel = page.getByTestId('transaction-panel')
      await panel.locator('.list-row-button').filter({ hasText: '[E2E_TEST] 編集する支出' }).click()
      const detail = page.getByRole('dialog', { name: '支出詳細' })
      await expect(detail).toBeVisible()
      await fits(page)
      const dir = process.env.KAKEIBO_EDIT_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `detail-${width}.png`), fullPage: true }) }

      await detail.getByRole('button', { name: '編集' }).click()
      const modal = page.getByTestId('transaction-modal')
      await expect(modal.getByRole('heading', { name: '支出を編集' })).toBeVisible()
      await expect(modal.getByLabel('金額')).toHaveValue('1000')
      await fits(page)
      if (dir) await page.screenshot({ path: join(dir, `edit-${width}.png`), fullPage: true })
      await modal.getByLabel('金額').fill('1500')
      await modal.getByRole('button', { name: '保存', exact: true }).click()
      await expect(modal).toBeHidden()
      await expect(detail).toContainText('-1,500円')
      expect(await balance(account.id)).toBe(8500)

      await detail.getByRole('button', { name: '削除' }).click()
      const confirm = page.getByRole('dialog', { name: '支出を削除しますか？' })
      await expect(confirm).toContainText('この操作は取り消せません')
      await fits(page)
      if (dir) await page.screenshot({ path: join(dir, `delete-${width}.png`), fullPage: true })
      await confirm.getByRole('button', { name: '削除する' }).click()
      await expect(confirm).toBeHidden()
      await expect(detail).toBeHidden()
      await expect(panel.locator('.list-row-button').filter({ hasText: '[E2E_TEST] 編集する支出' })).toHaveCount(0)
      expect(await balance(account.id)).toBe(10000)

      await panel.locator('.list-row-button').filter({ hasText: '[E2E_TEST] 請求中の支出' }).click()
      const lockedDetail = page.getByRole('dialog', { name: '支出詳細' })
      await expect(lockedDetail.getByRole('button', { name: '編集' })).toBeDisabled()
      await expect(lockedDetail.getByRole('button', { name: '削除' })).toBeDisabled()
      await expect(lockedDetail).toContainText('請求中・精算済みの割り勘がある支出は編集・削除できません')
      await fits(page)
    })
  })
}
