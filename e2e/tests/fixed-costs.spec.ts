import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-05 固定費', () => {
  test('固定費を登録すると一覧に表示され、削除できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'fixedcost')
    await page.goto('/kakeibo')
    // 固定費への入口は収支登録モーダルの中にある(#487)。画面を再読み込みせずに移動する。
    await page.getByRole('button', { name: '収支を登録', exact: true }).click()
    await page.evaluate(() => { (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload = true })
    await page.getByTestId('transaction-modal').getByRole('link', { name: '固定費で登録', exact: true }).click()
    await expect(page).toHaveURL(/\/fixed-costs$/)
    expect(await page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload)).toBe(true)
    await expect(page.getByTestId('transaction-modal')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '登録を始める', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '固定費を登録', exact: true })).toHaveCount(1)

    const name = '[E2E_TEST] 家賃'
    await page.getByRole('button', { name: '固定費を登録' }).click()
    const form = page.getByRole('dialog', { name: '固定費を登録', exact: true })
    for (const word of ['毎月', '支払日', '自動', '家計簿']) await expect(form).toContainText(word)
    await expect(form).toContainText(/月額.*予定|予定.*月額/)
    await expect(form.getByRole('button', { name: /^詳細設定/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(form.getByRole('button', { name: /を削除$/ })).toHaveCount(0)
    await page.getByLabel('固定費名').fill(name)
    await page.getByLabel('金額').fill('80000')
    await page.getByLabel('支払日').fill('27')
    await page.getByRole('button', { name: '登録', exact: true }).click()

    const row = page.getByTestId('fixed-costs-panel').getByRole('button', { name: `${name}の詳細` })
    await expect(row).toContainText('80,000円')
    await expect(row).toContainText('27日')

    await row.click()
    await page.getByRole('dialog', { name: '固定費詳細' }).getByRole('button', { name: name + 'を削除', exact: true }).click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(row).toHaveCount(0)
  })
})
