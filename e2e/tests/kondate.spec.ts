import { expect, test } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-09/F-10 レシピ・献立', () => {
  test('手動でレシピを登録し、今週の献立に割り当てられる', async ({ page }) => {
    await setupUserWithHousehold(page, 'kondate')
    await page.goto('/recipes')

    const title = '[E2E_TEST] 肉じゃが'
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill(title)
    await page.getByLabel('材料').fill('じゃがいも、牛肉、玉ねぎ')
    await page.getByLabel('手順').fill('煮る')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('recipes-panel')).toContainText(title)

    await page.goto('/menu')
    const menu = page.getByTestId('menu-panel')
    await menu.getByLabel('レシピ', { exact: true }).selectOption({ label: title })
    await menu.getByRole('button', { name: '追加' }).click()
    await expect(menu.getByRole('listitem').filter({ hasText: title })).toBeVisible()

    // 自由メモでも追加できる
    await menu.getByLabel('自由メモ', { exact: true }).check()
    await menu.getByLabel('自由メモの内容').fill('[E2E_TEST] 外食')
    await menu.getByRole('button', { name: '追加' }).click()
    await expect(menu.getByRole('listitem').filter({ hasText: '[E2E_TEST] 外食' })).toBeVisible()
  })
})
