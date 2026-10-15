import { expect, test } from './console-guard'
import { addTransaction, setupUserWithHousehold } from './support/flows'

test.describe('F-03/F-13 家計簿', () => {
  test('支出・収入を登録すると一覧と今月サマリーに反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'kakeibo')
    const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    const response = await page.request.post('/api/accounts', { headers: { Authorization: `Bearer ${token}` }, data: { name: '[E2E_TEST]入金口座', type: 'bank', balance: 0 } })
    expect(response.status()).toBe(201)
    const account = await response.json()
    await page.goto('/kakeibo')

    await addTransaction(page, '支出', 1200, '[E2E_TEST] ランチ')
    await addTransaction(page, '収入', 5000, '[E2E_TEST] 臨時収入', { accountId: account.id })

    const rows = page.getByTestId('transaction-panel').locator('.list-row-button')
    await expect(rows.filter({ hasText: '[E2E_TEST] ランチ' })).toContainText('-1,200円')
    await expect(rows.filter({ hasText: '[E2E_TEST] 臨時収入' })).toContainText('+5,000円')

    const summary = page.getByTestId('monthly-summary')
    await expect(summary).toContainText('今月支出：1200円')
    await expect(summary).toContainText('今月収入：5000円')
  })

  test('金額未入力では登録できない', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'kakeibo_invalid')
    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeVisible()
    await expect(modal.locator('.error')).not.toBeEmpty()
  })
})
