import { expect, test } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-07/F-08 在庫・買い物リスト', () => {
  test('閾値以下の在庫が買い物リストに載り、購入すると在庫に反映される', async ({ page }) => {
    await setupUserWithHousehold(page, 'zaiko')
    await page.goto('/zaiko')

    const name = '[E2E_TEST] 牛乳'
    await page.getByRole('button', { name: '在庫を登録' }).click()
    await page.getByLabel('品名').fill(name)
    await page.getByLabel('在庫個数').fill('0')
    await page.getByLabel('買い物リスト追加閾値').fill('1')
    await page.getByRole('button', { name: '保存' }).click()

    const inventoryRow = page.getByTestId('inventory-panel').getByRole('row').filter({ hasText: name })
    const quantity = inventoryRow.locator('.qty-value')
    await expect(quantity).toHaveText('0.0')

    const shopping = page.getByTestId('shopping-panel')
    const shoppingRow = shopping.getByRole('row').filter({ hasText: name })
    await expect(shoppingRow).toBeVisible()

    await shoppingRow.getByRole('button', { name: `${name}の購入個数を増やす` }).click()
    await shopping.getByRole('button', { name: '更新' }).click()

    await expect(quantity).toHaveText('1.0')
    await expect(shoppingRow).toHaveCount(0)
  })
})
