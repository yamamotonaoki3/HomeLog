import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'

// デモ環境(DEMO_MODE=true)の画面の確認(#534)。接続先は常にローカル(wrangler dev)。
// 開始の回数制限は接続元ごとなので、テストごとに TEST-NET-3(203.0.113.0/24)の別の接続元を名乗らせる。
// デモ利用者は架空のデモ太郎・デモ花子で、データも見本の架空値。

async function useClientAddress(page: Page, address: string) {
  await page.route('**/api/demo/start', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': address } }))
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

const banner = (page: Page) => page.getByRole('region', { name: 'デモのご案内' })

async function expectBannerFits(page: Page) {
  const box = await banner(page).evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }))
  expect(box.scroll).toBeLessThanOrEqual(box.client)
  for (const name of [/に切り替える$/, '見どころ', 'デモを終わる']) {
    const button = banner(page).getByRole('button', { name })
    const rect = await button.boundingBox()
    expect(rect?.height ?? 0).toBeGreaterThanOrEqual(44)
    const viewport = page.viewportSize()!
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
  }
}

const widths = [1280, 390, 320]

widths.forEach((width, index) => {
  test.describe(`デモ ${width}px (#534)`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 1280 })

    test('デモを始め、太郎と花子を切り替えて見比べられる', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await useClientAddress(page, `203.0.113.${10 + index}`)

      await page.goto('/login')
      await expect(page.getByText('架空の2人の世帯で、24時間お試しできます')).toBeVisible()
      await page.getByRole('button', { name: 'デモを試す（登録不要）' }).click()

      await expect(page).toHaveURL(/\/$/)
      await expect(banner(page).getByText(/^デモ中：デモ太郎として表示しています（残り\d+時間）$/)).toBeVisible()
      await expectBannerFits(page)
      await expectNoOverflow(page)

      await page.goto('/accounts')
      await expect(page.getByText('みどり銀行').first()).toBeVisible()
      await expect(page.getByText('さくら銀行')).toHaveCount(0)

      await banner(page).getByRole('button', { name: 'デモ花子に切り替える' }).click()
      await expect(banner(page).getByText(/^デモ中：デモ花子として表示しています/)).toBeVisible()
      await expect(page).toHaveURL(/\/$/)
      await expectBannerFits(page)
      await page.goto('/accounts')
      await expect(page.getByText('さくら銀行').first()).toBeVisible()
      await expect(page.getByText('みどり銀行')).toHaveCount(0)

      await page.goto('/zaiko')
      await expect(page.getByText('卵').first()).toBeVisible()
      await page.goto('/warikan')
      await expect(page.getByText('スーパー').first()).toBeVisible()

      const highlights = banner(page).getByRole('button', { name: '見どころ' })
      await highlights.click()
      await expect(highlights).toHaveAttribute('aria-expanded', 'true')
      await expect(banner(page).getByRole('listitem')).toHaveCount(4)
      await expectBannerFits(page)
      await expectNoOverflow(page)
      await highlights.click()
      await expect(highlights).toHaveAttribute('aria-expanded', 'false')

      await banner(page).getByRole('button', { name: 'デモを終わる' }).click()
      await expect(page).toHaveURL(/\/login/)
      await expect(banner(page)).toHaveCount(0)
    })
  })
})

test.describe('デモでは止める機能 (#534)', () => {
  test('アカウント設定の注記を出し、パスワード変更は「デモでは使えません」と表示する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    consoleGuard.allow({ url: /\/api\/auth\/password$/, message: /403/ })
    await useClientAddress(page, '203.0.113.20')

    await page.goto('/login')
    await page.getByRole('button', { name: 'デモを試す（登録不要）' }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/settings/account')
    await expect(page.getByText('デモでは表示名以外は変更できません')).toBeVisible()
    const passwordArea = page.getByRole('region', { name: 'パスワード' })
    await passwordArea.getByLabel('現在のパスワード').fill('TestPass123!')
    await passwordArea.getByLabel('新しいパスワード（8文字以上、英字と数字を含む）').fill('NewPass456')
    await passwordArea.getByLabel('新しいパスワード（確認）').fill('NewPass456')
    await passwordArea.getByRole('button', { name: 'パスワードを変更' }).click()
    await expect(passwordArea.getByRole('alert')).toHaveText('デモでは使えません')
  })
})
