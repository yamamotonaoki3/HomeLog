import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { register, createHousehold, login } from './support/flows'
import { newUser } from './support/test-data'

for (const width of [1280, 390, 320]) {
  test.describe(`ヘッダー本人名 ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1280 ? 900 : 844 }, hasTouch: width < 1280 })
    for (const [kind, displayName] of [
      ['short', 'e2euser_A'],
      ['japanese', 'e2euser_' + '名'.repeat(42)],
      ['latin', 'e2euser_' + 'A'.repeat(42)],
    ]) {
      test(`${kind}の本人識別・省略・操作・再読込・切替`, async ({ page, consoleGuard }) => {
        consoleGuard.watch(page)
        consoleGuard.allow({ url: /\/api\/households\/me$/, message: 'Failed to load resource: the server responded with a status of 404 (Not Found)' })
        const user = { ...newUser(`header_${kind}_${width}`), displayName }
        await register(page, user)
        await createHousehold(page, '[E2E_TEST] header household')
        const name = page.locator('.header-account-name')
        const logout = page.getByRole('button', { name: 'ログアウト', exact: true })
        const settings = page.getByRole('link', { name: '設定を開く' })
        const alarm = page.getByRole('img', { name: '通知アラーム（0件）' })
        await expect(name).toHaveText(displayName)
        await expect(alarm).toBeVisible()
        await expect(page.getByText('口座残高合計: 0円', { exact: true })).toBeVisible()
        const boxes = await Promise.all([alarm.boundingBox(), settings.boundingBox(), name.boundingBox(), logout.boundingBox()])
        for (const box of boxes) {
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        }
        expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x)
        expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[3]!.x)
        expect(boxes[2]!.y + boxes[2]!.height).toBeLessThanOrEqual(boxes[3]!.y)
        const metrics = await name.evaluate((el) => ({
          overflow: getComputedStyle(el).overflow, whiteSpace: getComputedStyle(el).whiteSpace,
          textOverflow: getComputedStyle(el).textOverflow, scroll: el.scrollWidth, client: el.clientWidth,
        }))
        expect(metrics).toMatchObject({ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' })
        if (kind === 'short') expect(metrics.scroll).toBeLessThanOrEqual(metrics.client)
        else expect(metrics.scroll).toBeGreaterThan(metrics.client)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const dir = process.env.HEADER_ACCOUNT_SCREENSHOT_DIR
        if (dir) {
          await mkdir(dir, { recursive: true })
          await page.screenshot({ path: join(dir, `dashboard-${width}-${kind}.png`), fullPage: true })
          await page.getByRole('banner').screenshot({ path: join(dir, `header-${width}-${kind}.png`) })
        }
        await page.reload()
        await expect(name).toHaveText(displayName)
        await settings.focus()
        await expect(settings).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(logout).toBeFocused()
        if (width < 1280) await settings.tap()
        else await settings.click()
        await expect(page).toHaveURL(/\/settings$/)
        await expect(name).toHaveText(displayName)
        await logout.click()
        await expect(page).toHaveURL(/\/login$/)
        const other = newUser('header_other')
        await register(page, other)
        await createHousehold(page, '[E2E_TEST] other household')
        await expect(name).toHaveText(other.displayName)
        await logout.click()
        await login(page, user)
        await expect(name).toHaveText(displayName)
        // 同じAuthProviderを維持したまま/loginへ遷移し、ログアウトせずBでログインする。
        await page.evaluate(() => {
          window.history.pushState({}, '', '/login')
          window.dispatchEvent(new PopStateEvent('popstate'))
        })
        await page.getByLabel('メールアドレス').fill(other.email)
        await page.locator('#login-password').fill(other.password)
        await page.getByRole('button', { name: 'ログイン', exact: true }).click()
        await expect(name).toHaveText(other.displayName)
        await expect(page).toHaveURL(/\/$/)
        // 応答を保留したままSPA内で別ユーザーへ切り替える。
        let releaseLogout!: () => void
        const pendingLogout = new Promise<void>((resolve) => { releaseLogout = resolve })
        await page.route('**/api/auth/logout', async (route) => {
          const response = await route.fetch()
          await pendingLogout
          await route.fulfill({ response })
        })
        try {
          await logout.click()
          await expect(page).toHaveURL(/\/login$/)
          await page.getByLabel('メールアドレス').fill(user.email)
          await page.locator('#login-password').fill(user.password)
          await page.getByRole('button', { name: 'ログイン', exact: true }).click()
          await expect(name).toHaveText(displayName)
          const completed = page.waitForResponse('**/api/auth/logout')
          releaseLogout()
          await (await completed).finished()
          await settings.click()
          await expect(page).toHaveURL(/\/settings$/)
          await expect(name).toHaveText(displayName)
        } finally {
          releaseLogout()
          await page.unrouteAll({ behavior: 'wait' })
        }
      })
    }
  })
}
