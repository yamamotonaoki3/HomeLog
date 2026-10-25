import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`タイトルバーと関連機能タブをスクロール後も操作できる ${width}px (#364)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `sticky_header_${width}`)

    for (const [path, navName, targetName, targetPath] of [
      ['/zaiko', '在庫管理関連機能', '買い物リスト', '/zaiko/shopping'],
      ['/kakeibo', '家計簿関連機能', '割り勘', '/warikan'],
      ['/menu', '献立表関連機能', 'レシピ', '/recipes'],
    ] as const) {
      await page.goto(path)
      const header = page.getByRole('banner')
      const navigation = page.getByRole('navigation', { name: navName })
      const headerBefore = (await header.boundingBox())!
      const navBefore = (await navigation.boundingBox())!
      const contentBefore = (await page.getByRole('main').boundingBox())!
      expect(headerBefore.y).toBe(0)
      expect(navBefore.y).toBeGreaterThanOrEqual(headerBefore.y + headerBefore.height)
      expect(contentBefore.y).toBeGreaterThanOrEqual(navBefore.y + navBefore.height)
      // 空の新規世帯でも十分な本文の高さを確保し、ブラウザの実スクロールを検証する。
      await page.getByRole('main').evaluate((el) => { el.style.minHeight = '2400px' })
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
      await expect.poll(async () => (await header.boundingBox())!.y).toBe(0)
      const headerAfter = (await header.boundingBox())!
      const navAfter = (await navigation.boundingBox())!
      expect(headerAfter.height).toBe(headerBefore.height)
      expect(navAfter.y).toBe(navBefore.y)
      expect(navAfter.height).toBe(navBefore.height)
      expect(navAfter.y + navAfter.height).toBeLessThan(844)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      for (const link of await navigation.getByRole('link').all()) {
        const box = (await link.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.y).toBeGreaterThanOrEqual(navAfter.y)
        expect(box.y + box.height).toBeLessThanOrEqual(navAfter.y + navAfter.height)
      }
      const screenshotDir = process.env.STICKY_HEADER_SCREENSHOT_DIR
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true })
        await page.screenshot({ path: join(screenshotDir, `sticky-${width}-${path.slice(1)}.png`) })
      }
      // 自動スクロールで一旦先頭へ戻ってしまわないよう、クリック前後の位置も検証する。
      await navigation.getByRole('link', { name: targetName, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${targetPath}$`))
      await expect(page.getByRole('navigation', { name: navName }).getByRole('link', { name: targetName, exact: true })).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
    }

    await page.getByRole('link', { name: '設定を開く' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('link', { name: 'HomeLog', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/zaiko')
    await page.getByRole('button', { name: '在庫を登録', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // 固定領域上もオーバーレイに覆われ、ヘッダーがモーダルより前へ出ない。
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(10, 10)?.closest('.modal-overlay')))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
}
