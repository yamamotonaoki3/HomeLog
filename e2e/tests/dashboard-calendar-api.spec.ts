import { expect, test } from '@playwright/test'
import { addTransaction, setupUserWithHousehold } from './support/flows'

test.describe('S-04 ダッシュボードカレンダーAPI', () => {
  test('実UIで登録した当日の収支・固定費・通知イベントを返す', async ({ page }) => {
    await setupUserWithHousehold(page, 'dashboard_calendar_api')
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const jstMonth = jstToday.slice(0, 7)
    const jstDay = String(Number(jstToday.slice(8, 10)))

    await page.goto('/kakeibo')
    await addTransaction(page, '支出', 1200, '[E2E_TEST] カレンダー支出', { date: jstToday })

    await page.goto('/fixed-costs')
    await page.getByRole('button', { name: '固定費を登録' }).click()
    await page.getByLabel('固定費名').fill('[E2E_TEST] カレンダー固定費')
    await page.getByLabel('金額').fill('1000')
    await page.getByLabel('支払日').fill(jstDay)
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('fixed-costs-panel').getByRole('row').filter({ hasText: '[E2E_TEST] カレンダー固定費' })).toBeVisible()

    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill('[E2E_TEST] カレンダーイベント')
    await page.getByLabel('日付').fill(jstToday)
    await page.getByLabel('通知する').check()
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('events-panel').getByRole('row').filter({ hasText: '[E2E_TEST] カレンダーイベント' })).toBeVisible()

    const accessToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    expect(accessToken).toBeTruthy()
    const response = await page.request.get(`/api/dashboard/calendar?month=${jstMonth}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json<{
      days: { date: string; fixedCosts: string[]; events: { name: string; isRecurring: boolean }[]; balance: number }[]
      notificationCount: number
    }>()
    expect(body.days.find((day) => day.date === jstToday)).toMatchObject({
      fixedCosts: ['[E2E_TEST] カレンダー固定費'],
      events: [{ name: '[E2E_TEST] カレンダーイベント', isRecurring: false }],
      balance: -1200,
    })
    expect(body.notificationCount).toBe(1)
  })
})
