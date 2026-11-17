import { openAccountMenu } from './support/flows'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

for (const width of [1280, 390, 320]) {
  test.describe(`アカウント設定 ${width}px (#292)`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 1280 })
    test('設定から開き、表示名・パスワード・メールアドレスを変更して新しい情報でログインできる', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      // 現在のパスワード誤りを確認する400は想定どおりのエラー応答。
      consoleGuard.allow({ url: /\/api\/auth\/password$/, message: /400 \(Bad Request\)/ })
      const user = await setupUserWithHousehold(page, `account_ui_${width}`)
      await page.getByRole('link', { name: '設定を開く' }).click()
      await page.getByRole('link', { name: 'アカウント設定を開く' }).click()
      const panel = page.getByTestId('account-settings-panel')
      await expect(panel.getByRole('heading', { name: 'アカウント設定', level: 2, exact: true })).toBeVisible()
      await expect(page.getByText(user.email)).toBeVisible()
      await expectNoOverflow(page)

      // 構成(#505)。4区画のカード、44px以上の押せる範囲、拡大されない入力欄。
      await expect(panel.getByRole('region')).toHaveCount(4)
      const deletionArea = panel.getByRole('region', { name: '退会', exact: true })
      const jump = panel.getByRole('navigation', { name: 'アカウント設定の項目', exact: true })
      await expect(jump.getByRole('link')).toHaveText(['表示名', 'パスワード', 'メール', '退会'])
      for (const control of [panel.getByRole('link', { name: '設定に戻る', exact: true }), ...await jump.getByRole('link').all(), ...await panel.getByRole('button').all()]) {
        const box = (await control.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      for (const input of await panel.locator('input').all()) expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
      for (const area of await panel.getByRole('region').all()) expect(await area.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      // 退会は最後の区画で、申し込みは現在のパスワードを入れるまで押せない。
      expect((await deletionArea.boundingBox())!.y).toBeGreaterThan((await panel.getByRole('region', { name: 'メールアドレス', exact: true }).boundingBox())!.y)
      await expect(deletionArea.getByRole('button', { name: '退会を申し込む', exact: true })).toBeDisabled()

      // 上部のリンクで区画へ移動する。入力途中の内容は残り、見出しは固定ヘッダーの下に隠れない。
      const draft = panel.getByRole('region', { name: 'パスワード', exact: true }).getByLabel('現在のパスワード')
      await draft.fill('[E2E_TEST] draft')
      await jump.getByRole('link', { name: '退会', exact: true }).click()
      const deletionHeading = deletionArea.getByRole('heading', { level: 3, name: '退会', exact: true })
      await expect(deletionHeading).toBeFocused()
      await expect(deletionHeading).toBeInViewport()
      const headerBottom = await page.locator('.app-shell header').first().evaluate(el => el.getBoundingClientRect().bottom)
      expect((await deletionHeading.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom)
      await expect(page).toHaveURL(/\/settings\/account$/)
      await expect(draft).toHaveValue('[E2E_TEST] draft')
      await jump.getByRole('link', { name: '表示名', exact: true }).click()
      await expect(panel.getByRole('region', { name: '表示名', exact: true }).getByRole('heading', { level: 3 })).toBeFocused()
      await draft.fill('')
      await page.evaluate(() => window.scrollTo(0, 0))
      const dir = process.env.ACCOUNT_SETTINGS_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `account-${width}.png`), fullPage: true }) }

      const nameArea = page.getByRole('region', { name: '表示名' })
      const renamed = `${user.displayName}_renamed`
      await nameArea.getByRole('textbox', { name: '表示名' }).fill(renamed)
      await nameArea.getByRole('button', { name: '保存' }).click()
      await expect(nameArea.getByRole('status')).toHaveText('表示名を変更しました')
      await expect(page.locator('.header-account-name')).toHaveText(renamed)

      const passwordArea = page.getByRole('region', { name: 'パスワード' })
      await passwordArea.getByLabel('現在のパスワード').fill('WrongPass1')
      await passwordArea.getByLabel('新しいパスワード（8文字以上、英字と数字を含む）').fill('NewPass456')
      await passwordArea.getByLabel('新しいパスワード（確認）').fill('NewPass456')
      await passwordArea.getByRole('button', { name: 'パスワードを変更' }).click()
      await expect(passwordArea.getByRole('alert')).toHaveText('現在のパスワードが正しくありません')
      await passwordArea.getByLabel('現在のパスワード').fill(user.password)
      await passwordArea.getByRole('button', { name: 'パスワードを変更' }).click()
      await expect(passwordArea.getByRole('status')).toContainText('パスワードを変更しました')

      const emailArea = page.getByRole('region', { name: 'メールアドレス' })
      const newEmail = user.email.replace('e2euser_', 'e2euser_new_')
      await emailArea.getByLabel('新しいメールアドレス').fill(newEmail)
      await emailArea.getByLabel('現在のパスワード').fill('NewPass456')
      await emailArea.getByRole('button', { name: 'メールアドレスを変更' }).click()
      await expect(emailArea.getByRole('status')).toContainText('メールアドレスを変更しました')
      await expect(emailArea.getByText(newEmail)).toBeVisible()
      await expectNoOverflow(page)
      if (dir) await page.screenshot({ path: join(dir, `account-done-${width}.png`), fullPage: true })

      await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
      await page.getByLabel('メールアドレス').fill(newEmail)
      await page.locator('#login-password').fill('NewPass456')
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(page.locator('.header-account-name')).toHaveText(renamed)
    })
  })
}
