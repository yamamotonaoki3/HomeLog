import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function dashboardCardHeadings(page: Page) {
  return page.locator('.dashboard-summary-grid > .card > h2').allTextContents()
}

async function orderListCards(page: Page) {
  return page.getByRole('list', { name: 'ダッシュボードのカード順' }).getByRole('listitem').evaluateAll((items) => items.map((item) => item.getAttribute('data-card')))
}

test.describe('S-21 表示設定とカード並べ替え', () => {
  test('表示OFFとボタン操作の並べ替えを保存すると、S-04へ遷移して反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'display_settings')

    await page.goto('/settings/display')
    await expect(page.getByText('よく使う品目')).toHaveCount(0)
    await page.getByRole('checkbox', { name: '個人の財政' }).uncheck()
    await expect.poll(() => orderListCards(page)).toEqual(['today', 'stock', 'money', 'eventExpenses'])

    const moveUp = page.getByRole('button', { name: '「イベント別支出」を上へ移動' })
    await moveUp.click()
    await moveUp.click()
    await moveUp.click()
    await expect.poll(() => orderListCards(page)).toEqual(['eventExpenses', 'today', 'stock', 'money'])
    await expect(page.getByRole('status')).toHaveText('「イベント別支出」を1番目に移動しました')

    await page.getByRole('group', { name: 'カレンダー' }).getByLabel('イベント').uncheck()
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '月間カレンダー' })).toBeVisible()
    await expect.poll(() => dashboardCardHeadings(page)).toEqual(['イベント別支出', '今日の状況', '買い物・在庫', '今月のお金'])
    await expect(page.getByRole('heading', { name: '個人の財政' })).toHaveCount(0)

    await page.goto('/settings/display')
    await expect(page.getByRole('checkbox', { name: '個人の財政' })).not.toBeChecked()
    await expect(page.getByRole('group', { name: 'カレンダー' }).getByLabel('イベント')).not.toBeChecked()
    await page.getByRole('checkbox', { name: '個人の財政' }).check()
    await expect.poll(() => orderListCards(page)).toEqual(['eventExpenses', 'today', 'stock', 'finance', 'money'])
  })

  test('ドラッグ操作で並べ替えて保存できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'display_settings_drag')

    await page.goto('/settings/display')
    const list = page.getByRole('list', { name: 'ダッシュボードのカード順' })
    await list.locator('[data-card="money"]').dragTo(list.locator('[data-card="today"]'))
    await expect.poll(() => orderListCards(page)).toEqual(['money', 'today', 'stock', 'finance', 'eventExpenses'])

    await page.getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => dashboardCardHeadings(page)).toEqual(['今月のお金', '今日の状況', '買い物・在庫', '個人の財政', 'イベント別支出'])
  })
})
