import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { login, createHousehold } from './support/flows'
import { newUser } from './support/test-data'

for (const width of [1280, 390, 320]) {
  test.describe(`本人情報APIと既存ヘッダー ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1280 ? 900 : 844 }, hasTouch: width < 1280 })
    test('世帯未所属の本人識別・限定レスポンス・認証拒否とページ幅', async ({ page, request, consoleGuard }) => {
      consoleGuard.watch(page)
      const users = [newUser('me_a'), newUser('me_b')]
      for (const user of users) {
        const registered = await request.post('/api/auth/register', { data: user })
        expect(registered.status()).toBe(201)
        const { id } = await registered.json()
        const loggedIn = await request.post('/api/auth/login', { data: { email: user.email, password: user.password } })
        expect(loggedIn.status()).toBe(200)
        const { accessToken, refreshToken } = await loggedIn.json()
        const headers = { Authorization: `Bearer ${accessToken}` }
        const me = await request.get('/api/auth/me?userId=2147483647', { headers })
        expect(me.status()).toBe(200)
        expect(await me.json()).toEqual({ id, displayName: user.displayName })
        const refreshed = await request.post('/api/auth/refresh', { data: { refreshToken } })
        expect(refreshed.status()).toBe(200)
        const refreshedMe = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${(await refreshed.json()).accessToken}` } })
        expect(refreshedMe.status()).toBe(200)
        expect(await refreshedMe.json()).toEqual({ id, displayName: user.displayName })
      }
      for (const headers of [{}, { Authorization: 'Bearer invalid' }]) {
        const denied = await request.get('/api/auth/me', { headers })
        expect(denied.status()).toBe(401)
        expect(await denied.json()).toMatchObject({ code: 'UNAUTHORIZED' })
      }
      // 未所属でログインした際の所属判定404だけを許可する。
      consoleGuard.allow({ url: /\/api\/households\/me$/, message: 'Failed to load resource: the server responded with a status of 404 (Not Found)' })
      await login(page, users[0])
      await expect(page).toHaveURL(/\/household$/)
      await createHousehold(page, '[E2E_TEST] me household')
      await expect(page.getByRole('img', { name: '通知アラーム（0件）' })).toBeVisible()
      await expect(page.getByRole('link', { name: '設定を開く' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
      await expect(page.getByText('口座残高合計: 0円', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const dir = process.env.AUTH_ME_SCREENSHOT_DIR
      if (dir) {
        await mkdir(dir, { recursive: true })
        await page.screenshot({ path: join(dir, `dashboard-${width}.png`), fullPage: true })
      }
    })
  })
}
