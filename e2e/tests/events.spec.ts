import { checkRow } from './support/list-row'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold, getInviteCode, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('.event-modal').all()) {
    expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px イベント統合モーダル`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('日時は上段に日付、下段に時刻または終日を揃えて表示する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'event_datetime' + width)
      await page.goto('/events')
      let dateColumnX: number | undefined
      for (const [index, label] of ['終日', '09:00〜', '09:00〜12:00'].entries()) {
        const name = `[E2E_TEST] 日時${index}`
        await page.getByRole('button', { name: 'イベントを登録' }).click()
        await page.getByLabel('イベント名').fill(name)
        await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
        if (index > 0) {
          await page.getByLabel('終日', { exact: true }).uncheck()
          await page.getByLabel('開始時刻').fill('09:00')
          if (index === 2) await page.getByLabel('終了時刻（任意）').fill('12:00')
        }
        await page.getByRole('button', { name: '登録', exact: true }).click()
        const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
        const date = row.getByText('2030-01-15', { exact: true })
        const time = row.getByText(label, { exact: true })
        await expect(date).toBeVisible()
        await expect(time).toBeVisible()
        const dateBox = (await date.boundingBox())!
        const timeBox = (await time.boundingBox())!
        expect(timeBox.y).toBeGreaterThanOrEqual(dateBox.y + dateBox.height)
        expect(timeBox.x).toBeCloseTo(dateBox.x, 0)
        if (dateColumnX !== undefined) expect(dateBox.x).toBeCloseTo(dateColumnX, 0)
        dateColumnX = dateBox.x
        for (const element of [date, time]) {
          expect(await element.evaluate(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return range.getClientRects().length
          })).toBe(1)
        }
        expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      }
      await fits(page)
      const shots = process.env.ISSUE_341_SHOTS_DIR
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: join(shots, `event-datetime-${width}.png`), fullPage: true })
      }
    })

    test('編集・集計・削除確認を同じモーダルで操作する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      consoleGuard.allow({ url: /\/api\/events\/\d+\/summary/, message: /404/ })
      await setupUserWithHousehold(page, 'event_unified' + width)
      await page.goto('/events')
      const name = '[E2E_TEST]' + 'A'.repeat(40)
      await page.getByRole('button', { name: 'イベントを登録' }).click()
      await page.getByLabel('イベント名').fill(name)
      await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
      await page.getByLabel('終日', { exact: true }).uncheck()
      await page.getByLabel('開始時刻').fill('20:00')
      await page.getByLabel('終了時刻（任意）').fill('21:00')
      await page.getByLabel('繰り返し', { exact: true }).selectOption('daily')
      await page.getByLabel('通知する', { exact: true }).check()
      await page.getByLabel('デフォルト金額（任意）').fill('1200')
      await page.getByRole('button', { name: '登録', exact: true }).click()
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await expect(row).toBeVisible()
      await checkRow(page, row, width, 'イベントを編集')
      await row.click()
      const modal = page.getByRole('dialog', { name: 'イベントを編集' })
      await expect(modal.getByLabel('イベント名')).toBeFocused()
      const shots = process.env.ISSUE_246_SHOTS_DIR
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: join(shots, `event-edit-top-${width}.png`), fullPage: true })
      }
      await expect(modal.getByLabel('通知する', { exact: true })).toBeChecked()
      await expect(modal.getByLabel('デフォルト金額（任意）')).toHaveValue('1200')
      await expect(modal).toContainText('支出合計：0円')
      await modal.getByLabel('イベント名').fill('[E2E_TEST] 編集済み')
      await modal.getByLabel('集計対象期間').selectOption('month')
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      await modal.getByRole('button', { name: '削除', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(modal.getByRole('button', { name: '削除をやめる' })).toBeFocused()
      await fits(page)
      if (shots) await page.screenshot({ path: join(shots, `event-edit-delete-${width}.png`), fullPage: true })
      await modal.getByRole('button', { name: '削除をやめる' }).click()
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      await modal.getByRole('button', { name: '更新', exact: true }).click()
      await expect(modal).toBeHidden()
      const updatedRow = page.getByRole('button', { name: '[E2E_TEST] 編集済みの詳細' })
      await expect(updatedRow).toBeFocused()
      await page.reload()
      await updatedRow.click()
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      await modal.getByLabel('トップ画面のイベント別支出サマリーに表示する').uncheck()
      await modal.getByRole('button', { name: '更新', exact: true }).click()
      await expect(modal).toBeHidden()
      await updatedRow.click()
      await expect(modal).toContainText('集計対象外')
      await fits(page)
      await modal.getByRole('button', { name: '削除', exact: true }).click()
      await modal.getByRole('button', { name: '削除する', exact: true }).click()
      await expect(page.getByTestId('events-panel')).toContainText('イベントはありません')
      await expect(page.getByRole('button', { name: 'イベントを登録' })).toBeFocused()
    })
  })
}

test('共有イベントは別メンバーが詳細を閲覧でき変更操作は表示されない', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'event_owner')
  const code = await getInviteCode(page)
  await page.goto('/events')
  await page.getByRole('button', { name: 'イベントを登録' }).click()
  await page.getByLabel('イベント名').fill('[E2E_TEST] 共有イベント')
  await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
  await page.getByRole('button', { name: '登録', exact: true }).click()
  await expect(page.getByRole('button', { name: '[E2E_TEST] 共有イベントの詳細', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await register(page, newUser('event_member'))
  await joinHousehold(page, code)
  await page.goto('/events')
  await page.getByRole('button', { name: '[E2E_TEST] 共有イベントの詳細', exact: true }).click()
  const detail = page.getByRole('dialog', { name: 'イベント詳細' })
  await expect(detail).toContainText('世帯共有')
  await expect(detail).toContainText('表示する')
  await expect(detail.getByRole('button', { name: /編集|削除|表示する|表示しない/ })).toHaveCount(0)
})
