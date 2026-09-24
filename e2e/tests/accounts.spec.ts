import { expect, test } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-11 口座・取引履歴', () => {
  test('口座に紐づけた支出が取引履歴と残高に反映される', async ({ page }) => {
    await setupUserWithHousehold(page, 'accounts')
    await page.goto('/accounts')

    const accountName = '[E2E_TEST] 生活口座'
    await page.getByRole('button', { name: '口座を登録' }).click()
    await page.getByLabel('口座名').fill(accountName)
    await page.getByLabel('初期残高').fill('10000')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    const accounts = page.getByTestId('accounts-panel')
    await expect(accounts).toContainText('残高: 10000円')

    const purpose = '[E2E_TEST] 日用品'
    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByLabel('金額').fill('2500')
    await modal.getByLabel('使用用途（任意）').fill(purpose)
    await modal.getByLabel('口座/カード（任意）').selectOption({ label: accountName })
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()

    await page.goto('/accounts')
    await expect(accounts).toContainText('残高: 7500円')
    await accounts.getByRole('button', { name: accountName }).click()
    const history = page.getByTestId('account-transactions-modal')
    const row = history.getByRole('row').filter({ hasText: purpose })
    await expect(row).toContainText('-2500円')
    await expect(row).toContainText('7500円')
  })
})
