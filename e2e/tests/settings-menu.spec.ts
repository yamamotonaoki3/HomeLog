import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// 設定トップ(S-25)。3つの入口を同じ形のカードで並べる(#499)。
const entries = [
  ['世帯設定', '世帯設定を開く', /\/household\/settings$/],
  ['表示設定', '表示設定を開く', /\/settings\/display$/],
  ['アカウント設定', 'アカウント設定を開く', /\/settings\/account$/],
] as const

for (const width of [1280, 390, 320]) {
  test(`設定トップは3つの入口をカードで並べ、横にはみ出さない ${width}px (#499)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `settings_menu_${width}`)
    // 入口の画面では、各設定の中身を取りに行かない(世帯の所属確認は画面の外側の共通処理が行うので数えない)。
    const settingsRequests: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (['/api/user-settings', '/api/auth/account'].includes(path)) settingsRequests.push(path)
    })
    await page.goto('/settings')
    const panel = page.getByTestId('settings-panel')
    await expect(panel.getByRole('heading', { level: 2, name: '設定', exact: true })).toBeVisible()
    await expect(panel.getByText('世帯・表示・アカウントの設定を開きます', { exact: true })).toBeVisible()
    const items = panel.getByRole('list', { name: '設定の種類', exact: true }).getByRole('listitem')
    await expect(items).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    for (const [index, [title, linkName]] of entries.entries()) {
      const item = items.nth(index)
      await expect(item.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible()
      const link = item.getByRole('link', { name: linkName, exact: true })
      const [box, itemBox, textBox] = await Promise.all([link.boundingBox(), item.boundingBox(), item.locator('p').boundingBox()])
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(itemBox!.x)
      expect(box!.x + box!.width).toBeLessThanOrEqual(itemBox!.x + itemBox!.width)
      // 説明文は読める幅を保つ(狭い画面ではボタンを下の段へ回す)。
      expect(textBox!.width).toBeGreaterThanOrEqual(150)
    }

    // キーボードで3つの入口を順に移動できる。
    await items.nth(0).getByRole('link').focus()
    for (const [, linkName] of entries.slice(1)) {
      await page.keyboard.press('Tab')
      await expect(panel.getByRole('link', { name: linkName, exact: true })).toBeFocused()
    }
    expect(await panel.getByRole('link', { name: 'アカウント設定を開く', exact: true }).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')

    const directory = process.env.SETTINGS_SHOTS_DIR
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, `settings-menu-${width}.png`), fullPage: true }) }
    expect(settingsRequests).toEqual([])

    for (const [, linkName, url] of entries) {
      await page.goto('/settings')
      await panel.getByRole('link', { name: linkName, exact: true }).click()
      await expect(page).toHaveURL(url)
    }
  })
}
