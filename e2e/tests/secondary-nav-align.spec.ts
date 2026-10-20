import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// 各画面上部のサブタブは左寄せで並べる(#323)。
for (const width of [1280, 390, 320]) {
  test(`${width}px 在庫管理・家計簿・献立表のサブタブが左寄せで表示される (#323)`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await setupUserWithHousehold(page, `secondary_nav_${width}`)
    for (const [path, label] of [['/zaiko', '在庫管理関連機能'], ['/kakeibo', '家計簿関連機能'], ['/menu', '献立表関連機能']] as const) {
      await page.goto(path)
      const nav = page.getByRole('navigation', { name: label })
      const navBox = (await nav.boundingBox())!
      const firstBox = (await nav.getByRole('link').first().boundingBox())!
      const paddingLeft = await nav.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
      expect(Math.abs(firstBox.x - (navBox.x + paddingLeft))).toBeLessThanOrEqual(1)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  })
}
