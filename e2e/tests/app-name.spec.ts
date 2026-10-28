import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`シェファミの表示と既存ログイン・登録導線を維持する ${width}px (#386)`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/login')
    await expect(page).toHaveTitle('シェファミ')
    await expect(page.getByRole('heading', { name: 'シェファミ', exact: true })).toBeVisible()
    await setupUserWithHousehold(page, `app_name_${width}`)
    const home = page.getByRole('link', { name: 'シェファミ', exact: true })
    await expect(home).toBeVisible()
    expect(await page.evaluate(() => Boolean(localStorage.getItem('homelog.accessToken')))).toBe(true)
    for (const path of ['/zaiko', '/menu', '/recipes']) {
      await page.goto(path)
      await expect(page).toHaveTitle('シェファミ')
      await expect(home).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    await expect(page.getByRole('link', { name: 'シェファミに登録', exact: true })).toBeVisible()
    await page.goto('/recipes/iphone-shortcut')
    await expect(page.getByText('追加されるショートカットは本番のシェファミを開きます。')).toBeVisible()
    await expect(page.getByText(/配布中のショートカット名は「homelogに登録」です/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'ショートカットを追加', exact: true })).toHaveAttribute('href', 'https://www.icloud.com/shortcuts/3914da403d2f41baa61d24a40ea9c699')
    await home.click()
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(home).toBeVisible()
    expect(await page.evaluate(() => Boolean(localStorage.getItem('homelog.accessToken')))).toBe(true)
    if (process.env.APP_NAME_SCREENSHOT_DIR) {
      await mkdir(process.env.APP_NAME_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.APP_NAME_SCREENSHOT_DIR, `shefami-${width}.png`), fullPage: true })
    }
  })
}
