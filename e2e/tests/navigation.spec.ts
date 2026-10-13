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

test('スマホ幅でも上部タブが横にはみ出さず、すべて画面内に表示される', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'navigation_fit')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const [path, name] of [
      ['/kakeibo', '家計簿関連機能'],
      ['/zaiko', '在庫管理関連機能'],
      ['/menu', '献立表関連機能'],
    ] as const) {
      await page.goto(path)
      const navigation = page.getByRole('navigation', { name })
      await expect(navigation).toBeVisible()
      // 横スクロールが発生していない
      expect(await navigation.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      for (const link of await navigation.getByRole('link').all()) {
        const box = await link.boundingBox()
        expect(box, `${path} の「${await link.textContent()}」(${width}px)`).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
    }
  }
})
