import { expect, test, type Page } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

async function addTransaction(page: Page, kind: '支出' | '収入', amount: number, text: string) {
  await page.getByRole('button', { name: '登録', exact: true }).first().click()
  const modal = page.getByTestId('transaction-modal')
  await modal.getByRole('tab', { name: kind }).click()
  await modal.getByLabel('金額').fill(String(amount))
  await modal.getByLabel(kind === '支出' ? '使用用途（任意）' : '収入内容').fill(text)
  await modal.getByRole('button', { name: '登録', exact: true }).click()
  await expect(modal).toBeHidden()
}

test.describe('F-03/F-13 家計簿', () => {
  test('支出・収入を登録すると一覧と今月サマリーに反映される', async ({ page }) => {
    await setupUserWithHousehold(page, 'kakeibo')
    await page.goto('/kakeibo')

    await addTransaction(page, '支出', 1200, '[E2E_TEST] ランチ')
    await addTransaction(page, '収入', 5000, '[E2E_TEST] 臨時収入')

    const rows = page.getByRole('row')
    await expect(rows.filter({ hasText: '[E2E_TEST] ランチ' })).toContainText('1200')
    await expect(rows.filter({ hasText: '[E2E_TEST] 臨時収入' })).toContainText('5000')

    const summary = page.getByTestId('monthly-summary')
    await expect(summary).toContainText('今月支出：1200円')
    await expect(summary).toContainText('今月収入：5000円')
  })

  test('金額未入力では登録できない', async ({ page }) => {
    await setupUserWithHousehold(page, 'kakeibo_invalid')
    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeVisible()
    await expect(modal.locator('.error')).not.toBeEmpty()
  })
})
