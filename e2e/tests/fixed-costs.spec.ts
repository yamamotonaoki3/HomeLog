import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-05 固定費', () => {
  test('固定費を登録すると一覧に表示され、削除できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'fixedcost')
    await page.goto('/fixed-costs')

    const name = '[E2E_TEST] 家賃'
    await page.getByRole('button', { name: '固定費を登録' }).click()
    await page.getByLabel('固定費名').fill(name)
    await page.getByLabel('金額').fill('80000')
    await page.getByLabel('支払日').fill('27')
    await page.getByRole('button', { name: '登録', exact: true }).click()

    const row = page.getByTestId('fixed-costs-panel').getByRole('button', { name: `${name}の詳細` })
    await expect(row).toContainText('80000円')
    await expect(row).toContainText('27日')

    await row.click()
    await page.getByRole('dialog', { name: '固定費詳細' }).getByRole('button', { name: '削除' }).click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(row).toHaveCount(0)
  })
})
