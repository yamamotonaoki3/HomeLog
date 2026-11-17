import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test.describe(width + 'px 口座削除 #424', () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('履歴のある口座を二段確認で削除し、履歴と他口座を維持する (#371)', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'account_delete_ui_' + width)
      const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
      const targetRes = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 削除する口座', type: 'bank', balance: 5000 } })
      const keepRes = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 残す口座', type: 'bank', balance: 3000 } })
      expect(targetRes.status()).toBe(201)
      expect(keepRes.status()).toBe(201)
      const target = await targetRes.json()
      const categories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
      const expenseDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
      const expense = await page.request.post('/api/expenses', { headers, data: { expenseDate, amount: 700, purpose: '[E2E_TEST] 履歴の支出', categoryId: categories[0].id, accountId: target.id } })
      expect(expense.status()).toBe(201)
      await page.goto('/accounts')
      const list = page.getByRole('list', { name: '口座一覧', exact: true })
      const targetRow = list.getByRole('button', { name: target.name + 'の詳細', exact: true })
      await targetRow.click()
      const region = page.getByRole('region', { name: target.name + 'の詳細', exact: true })
      await region.getByRole('button', { name: target.name + 'の取引履歴', exact: true }).click()
      const dialog = page.getByTestId('account-transactions-modal')
      await expect(dialog.getByText('[E2E_TEST] 履歴の支出')).toBeVisible()
      const headerClose = dialog.getByRole('button', { name: '取引履歴を閉じる', exact: true })
      await expect(headerClose).toBeFocused()
      const trash = dialog.getByRole('button', { name: target.name + 'を削除', exact: true })
      const trashBox = (await trash.boundingBox())!
      expect(trashBox.width).toBeGreaterThanOrEqual(44)
      expect(trashBox.height).toBeGreaterThanOrEqual(44)
      expect(trashBox.x).toBeGreaterThan((await dialog.boundingBox())!.x + (await dialog.boundingBox())!.width / 2)
      await trash.click()
      await expect(dialog.getByText(/取引履歴は残ります/)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
      await expect(trash).toBeFocused()
      const focused = await trash.boundingBox()
      expect(focused!.y).toBeGreaterThanOrEqual(0)
      expect(focused!.y + focused!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      expect(await (await page.request.get('/api/accounts', { headers })).json()).toHaveLength(2)
      await trash.click()
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab')
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
        const rect = await page.evaluate(() => { const box = document.activeElement!.getBoundingClientRect(); return { top: box.top, bottom: box.bottom } })
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(rect.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      if (process.env.ACCOUNT_DELETE_SCREENSHOT_DIR) {
        await mkdir(process.env.ACCOUNT_DELETE_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.ACCOUNT_DELETE_SCREENSHOT_DIR, 'account-delete-' + width + '.png') })
      }
      const submit = dialog.getByRole('button', { name: '削除する', exact: true })
      let release = () => {}
      if (width === 390) {
        let attempts = 0, failRefresh = false
        const pending = new Promise<void>(resolve => { release = resolve })
        consoleGuard.allow({ url: new RegExp('/api/accounts/' + target.id + '$'), message: /^Failed to load resource:.*500/ })
        consoleGuard.allow({ url: /\/api\/accounts$/, message: /^Failed to load resource:.*500/ })
        await page.route('**/api/accounts', async route => {
          if (route.request().method() === 'GET' && failRefresh) {
            failRefresh = false
            return route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '[E2E_TEST] 一覧再取得失敗' } })
          }
          return route.continue()
        })
        await page.route('**/api/accounts/' + target.id, async route => {
          if (route.request().method() !== 'DELETE') return route.continue()
          if (++attempts === 1) {
            await pending
            return route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '[E2E_TEST] 書込前削除失敗' } })
          }
          const response = await route.fetch()
          expect(response.status()).toBe(204)
          failRefresh = true
          return route.fulfill({ response })
        })
        try {
          await submit.click()
          await expect.poll(() => attempts).toBe(1)
          await expect(submit).toBeDisabled()
          await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeDisabled()
          await expect(headerClose).toBeDisabled()
          await page.keyboard.press('Escape')
          await dialog.locator('..').click({ position: { x: 2, y: 2 } })
          await expect(dialog).toBeVisible()
          expect(attempts).toBe(1)
          release()
          await expect(dialog.getByRole('alert')).toContainText('[E2E_TEST] 書込前削除失敗')
          await expect(submit).toBeEnabled()
          expect(await (await page.request.get('/api/accounts', { headers })).json()).toHaveLength(2)
          await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
          await expect(trash).toBeFocused()
          await trash.click()
          await submit.click()
          await expect(dialog.getByRole('alert')).toContainText('削除は完了しました')
          await expect(dialog.getByRole('button', { name: '削除する', exact: true })).toHaveCount(0)
          await expect(trash).toHaveCount(0)
          await expect(headerClose).toBeFocused()
          await expect(headerClose).toBeInViewport()
          expect(attempts).toBe(2)
          await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
          expect(attempts).toBe(2)
        } finally { release() }
      } else {
        await submit.click()
        await expect(page.getByRole('status')).toContainText('口座を削除しました')
      }
      await expect(dialog).toBeHidden()
      await expect(targetRow).toHaveCount(0)
      await expect(list.getByRole('button', { name: '[E2E_TEST] 残す口座の詳細', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '口座を登録', exact: true })).toBeFocused()
      const expenses = await (await page.request.get('/api/expenses', { headers })).json()
      expect(JSON.stringify(expenses)).toContain('[E2E_TEST] 履歴の支出')
      const accounts = await (await page.request.get('/api/accounts', { headers })).json()
      expect(accounts.map((account: { name: string }) => account.name)).toEqual(['[E2E_TEST] 残す口座'])
      const reuse = await page.request.post('/api/expenses', { headers, data: { expenseDate, amount: 1, purpose: '[E2E_TEST] 再利用', categoryId: categories[0].id, accountId: target.id } })
      expect(reuse.status()).toBe(400)
      await page.goto('/kakeibo')
      await page.getByTestId('transaction-panel').getByRole('button', { name: '収支を登録', exact: true }).click()
      const options = page.locator('#tx-account option')
      await expect(options.filter({ hasText: '残す口座' })).toHaveCount(1)
      await expect(options.filter({ hasText: '削除する口座' })).toHaveCount(0)
    })
  })
}
