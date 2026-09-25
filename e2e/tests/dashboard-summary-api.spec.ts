import { expect, test } from '@playwright/test'
import { addTransaction, setupUserWithHousehold } from './support/flows'

test.describe('S-04 ダッシュボード集計API', () => {
  test('本人の収支・今週の献立・当日イベントを実プロセス経由で返す', async ({ page }) => {
    await setupUserWithHousehold(page, 'dashboard_api')
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await page.goto('/kakeibo')
    await addTransaction(page, '支出', 1200, '[E2E_TEST] ダッシュボード支出', { date: jstToday })

    await page.goto('/recipes')
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill('[E2E_TEST] ダッシュボード献立')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await page.goto('/menu')
    await page.getByLabel('レシピ', { exact: true }).selectOption({ label: '[E2E_TEST] ダッシュボード献立' })
    await page.getByRole('button', { name: '追加' }).click()

    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill('[E2E_TEST] ダッシュボードイベント')
    await page.getByLabel('日付').fill(jstToday)
    await page.getByRole('button', { name: '登録', exact: true }).click()

    const accessToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    expect(accessToken).toBeTruthy()
    const response = await page.request.get('/api/dashboard/summary', { headers: { Authorization: `Bearer ${accessToken}` } })
    expect(response.ok()).toBeTruthy()
    const body = await response.json<{
      todayBalance: number
      monthlyPersonalExpense: number
      weeklyMenuEntries: { recipeTitle: string | null; freeTextMemo: string | null }[]
      todayEvents: { name: string; recurrenceType: string }[]
    }>()
    expect(body.todayBalance).toBe(-1200)
    expect(body.monthlyPersonalExpense).toBe(1200)
    expect(body.weeklyMenuEntries).toContainEqual({ recipeTitle: '[E2E_TEST] ダッシュボード献立', freeTextMemo: null })
    expect(body.todayEvents).toContainEqual({ name: '[E2E_TEST] ダッシュボードイベント', recurrenceType: 'none' })
  })
})
