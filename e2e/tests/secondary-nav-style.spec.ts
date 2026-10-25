import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`上部タブは選択中だけ下線を表示し、キーボードと遷移を維持する ${width}px (#370)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `underline_tabs_${width}`)
    for (const [path, name, nextName, nextPath] of [
      ['/zaiko', '在庫管理関連機能', '買い物リスト', '/zaiko/shopping'],
      ['/kakeibo', '家計簿関連機能', '割り勘', '/warikan'],
      ['/menu', '献立表関連機能', 'レシピ', '/recipes'],
    ] as const) {
      await page.goto(path)
      const nav = page.getByRole('navigation', { name })
      const active = nav.locator('[aria-current="page"]')
      await expect(active).toHaveCount(1)
      await expect(active).toHaveCSS('border-bottom-color', 'rgb(29, 78, 216)')
      await expect(active).toHaveCSS('border-bottom-width', '3px')
      await expect(active).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      for (const link of await nav.getByRole('link').all()) {
        await expect(link).toHaveCSS('border-top-width', '0px')
        await expect(link).toHaveCSS('border-left-width', '0px')
        await expect(link).toHaveCSS('border-radius', '0px')
        const box = (await link.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.height).toBeGreaterThanOrEqual(40)
      }
      const next = nav.getByRole('link', { name: nextName, exact: true })
      await expect(next).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
      await active.focus()
      await page.keyboard.press('Tab')
      await expect(next).toBeFocused()
      await expect(next).toHaveCSS('outline-style', 'solid')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const dir = process.env.SECONDARY_NAV_SCREENSHOT_DIR
      if (dir) {
        await mkdir(dir, { recursive: true })
        await page.screenshot({ path: join(dir, `tabs-${width}-${path.slice(1)}.png`) })
      }
      await next.click()
      await expect(page).toHaveURL(new RegExp(`${nextPath}$`))
      await expect(next).toHaveAttribute('aria-current', 'page')
      await expect(next).toHaveCSS('border-bottom-color', 'rgb(29, 78, 216)')
      await expect(page.getByRole('navigation', { name: '主要機能' })).toHaveCSS('background-color', 'rgb(30, 41, 59)')
    }
  })
}
