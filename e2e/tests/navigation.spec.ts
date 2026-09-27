import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('主要機能の下部ナビゲーションと関連機能への導線が動作する', async ({ page, consoleGuard }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'navigation')

  const primaryNavigation = page.getByRole('navigation', { name: '主要機能' })
  await expect(primaryNavigation.getByRole('link', { name: '在庫管理' })).toBeVisible()
  await expect(primaryNavigation.getByRole('link', { name: '家計簿' })).toBeVisible()
  await expect(primaryNavigation.getByRole('link', { name: '献立表' })).toBeVisible()
  const navBounds = await primaryNavigation.boundingBox()
  expect(navBounds).not.toBeNull()
  expect(navBounds!.y + navBounds!.height).toBe(844)

  await page.getByRole('link', { name: '設定を開く' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '世帯設定を開く' })).toBeVisible()
  await expect(page.getByRole('link', { name: '表示設定を開く' })).toBeVisible()

  await primaryNavigation.getByRole('link', { name: '家計簿' }).click()
  await expect(page).toHaveURL(/\/kakeibo$/)
  const kakeiboNavigation = page.getByRole('navigation', { name: '家計簿関連機能' })
  await expect(kakeiboNavigation.getByRole('link', { name: '割り勘' })).toBeVisible()
  await expect(kakeiboNavigation.getByRole('link', { name: '口座・カード管理' })).toBeVisible()

  await primaryNavigation.getByRole('link', { name: '献立表' }).click()
  await expect(page).toHaveURL(/\/menu$/)
  await expect(page.getByRole('navigation', { name: '献立表関連機能' }).getByRole('link', { name: 'レシピ' })).toBeVisible()
})
