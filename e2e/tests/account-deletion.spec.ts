import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

for (const width of [1280, 390, 320]) {
  test.describe(`退会 ${width}px (#298)`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 1280 })
    test('アカウント設定から退会を申し込み、取り消し期間中のログインで取り消せる', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      // 申し込み後のログアウトAPI・取り消し期間中のログインは、想定どおりのエラー応答を返す。
      consoleGuard.allow({ url: /\/api\/auth\/logout$/, message: /40[01]/ })
      consoleGuard.allow({ url: /\/api\/auth\/login$/, message: /403 \(Forbidden\)/ })
      const user = await setupUserWithHousehold(page, `deletion_ui_${width}`)
      await page.goto('/settings/account')
      const area = page.getByRole('region', { name: '退会' })
      await expect(area.getByText(/30日以内/)).toBeVisible()
      await area.getByLabel('現在のパスワード').fill(user.password)
      await area.getByRole('button', { name: '退会を申し込む' }).click()
      const dialog = page.getByRole('dialog', { name: '本当に退会しますか？' })
      await expect(dialog).toBeVisible()
      await expectNoOverflow(page)
      const dir = process.env.ACCOUNT_SETTINGS_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `deletion-confirm-${width}.png`) }) }
      await dialog.getByRole('button', { name: '退会する' }).click()

      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('status')).toContainText('退会を申し込みました')
      await page.getByLabel('メールアドレス').fill(user.email)
      await page.locator('#login-password').fill(user.password)
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      const notice = page.getByRole('region', { name: '退会手続き中です' })
      await expect(notice).toContainText('に削除されます')
      await expectNoOverflow(page)
      if (dir) await page.screenshot({ path: join(dir, `deletion-pending-${width}.png`) })
      await notice.getByRole('button', { name: '退会を取り消してログイン' }).click()
      await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible()
      await expect(page.locator('.header-account-name')).toHaveText(user.displayName)
    })
  })
}
