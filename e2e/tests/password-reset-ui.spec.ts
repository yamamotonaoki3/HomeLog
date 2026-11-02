import { expect, test } from './console-guard'

// パスワード再設定画面(#402)。実メール・実GASには接続しない。
// 利用可否・実トークンの拒否はローカルAPIで、メール送信後の流れはAPIの応答を差し替えて確認する。
const OPAQUE_TOKEN = 'opaque-token-abcdefghijklmnopqrstuvwxyz0123456789'
const NEW_PASSWORD = 'NewPassw0rd'
const PASSWORD_LABEL = '新しいパスワード（8文字以上、英字と数字を含む）'
const BAD_REQUEST_LOG = 'Failed to load resource: the server responded with a status of 400 (Bad Request)'

for (const width of [1280, 390, 320]) {
  test.describe(`パスワード再設定画面 ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1280 ? 900 : 844 }, hasTouch: width < 1280 })

    async function expectNoHorizontalScroll(page: import('@playwright/test').Page) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    }

    test('ローカルAPI: 利用不可の案内と、無効なリンクからの申請し直し', async ({ page, request, consoleGuard }) => {
      consoleGuard.watch(page)
      consoleGuard.allow({ message: BAD_REQUEST_LOG, url: /\/api\/auth\/password-reset\/confirm$/ })
      const { available } = await (await request.get('/api/auth/password-reset/availability')).json()
      test.skip(available, 'ローカルでメールなしの確認用フラグが有効な場合は対象外')

      await page.goto('/password-reset')
      await expect(page.getByText('現在、パスワード再設定メールを利用できません')).toBeVisible()
      await expect(page.getByLabel('メールアドレス')).toHaveCount(0)
      await expect(page.getByLabel('リセットトークン')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'ログイン画面へ戻る' })).toBeVisible()
      await expectNoHorizontalScroll(page)

      // 実APIは存在しないトークンを拒否する。画面はURLからトークンを取り除き、申請し直しへ案内する。
      await page.goto(`/password-reset#token=${OPAQUE_TOKEN}`)
      await expect(page.getByLabel(PASSWORD_LABEL)).toBeVisible()
      await expect(page).toHaveURL(/\/password-reset$/)
      await page.getByLabel(PASSWORD_LABEL).fill(NEW_PASSWORD)
      await page.getByLabel('新しいパスワード（確認）').fill(NEW_PASSWORD)
      await page.getByRole('button', { name: '変更する' }).click()
      await expect(page.getByRole('alert')).toContainText('無効か、期限切れ')
      await expectNoHorizontalScroll(page)
      await page.getByRole('button', { name: '再設定を申請し直す' }).click()
      await expect(page.getByText('現在、パスワード再設定メールを利用できません')).toBeVisible()
    })

    test('メール送信後の流れ: 申請の案内 → メールのリンク → 再設定してログイン画面へ', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      let confirmRequest: { url: string; body: unknown } | undefined
      await page.route('**/api/auth/password-reset/availability', (route) => route.fulfill({ json: { available: true } }))
      await page.route('**/api/auth/password-reset/request', (route) =>
        route.fulfill({ json: { message: '入力されたメールアドレスが登録済みの場合、再設定の案内メールを送信します。届かない場合は、しばらく待ってからもう一度お試しください' } }))
      await page.route('**/api/auth/password-reset/confirm', (route) => {
        confirmRequest = { url: route.request().url(), body: route.request().postDataJSON() }
        return route.fulfill({ status: 200, body: '' })
      })

      await page.goto('/password-reset')
      await page.getByLabel('メールアドレス').fill('e2euser_reset@example.com')
      await page.getByRole('button', { name: '申請する' }).click()
      await expect(page.getByText('登録済みの場合、再設定の案内メールを送信します')).toBeVisible()
      await expect(page.getByText(/迷惑メール/)).toBeVisible()
      await expect(page.getByLabel('リセットトークン')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'もう一度申請する' })).toBeVisible()
      await expectNoHorizontalScroll(page)

      // メールのリンクを開く。開くだけではconfirmを呼ばず、トークンはURLから取り除かれる。
      await page.goto(`/password-reset#token=${OPAQUE_TOKEN}`)
      await expect(page.getByLabel(PASSWORD_LABEL)).toBeVisible()
      await expect(page).toHaveURL(/\/password-reset$/)
      expect(page.url()).not.toContain(OPAQUE_TOKEN)
      expect(confirmRequest).toBeUndefined()
      await expect(page.getByText(/再読み込みすると/)).toBeVisible()
      await page.getByLabel(PASSWORD_LABEL).fill(NEW_PASSWORD)
      await page.getByLabel('新しいパスワード（確認）').fill(`${NEW_PASSWORD}x`)
      await page.getByRole('button', { name: '変更する' }).click()
      await expect(page.getByText('パスワードが一致しません')).toBeVisible()
      expect(confirmRequest).toBeUndefined()
      await expectNoHorizontalScroll(page)
      await page.getByLabel('新しいパスワード（確認）').fill(NEW_PASSWORD)
      await page.getByRole('button', { name: '変更する' }).click()
      await expect(page).toHaveURL(/\/login$/)
      expect(confirmRequest?.body).toEqual({ token: OPAQUE_TOKEN, newPassword: NEW_PASSWORD })
      expect(confirmRequest?.url).not.toContain(OPAQUE_TOKEN)
    })
  })
}
