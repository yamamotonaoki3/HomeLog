import { expect, test } from '@playwright/test'
import { addTransaction, setupUserWithHousehold } from './support/flows'

test.describe('S-04 ダッシュボード集計API', () => {
  test('データがない新規世帯でも今日の状況と今月のお金を表示できる', async ({ page }) => {
    await setupUserWithHousehold(page, 'dashboard_empty')

    await expect(page.getByRole('heading', { name: '今日の状況' })).toBeVisible()
    await expect(page.getByText('収支: 0円')).toBeVisible()
    await expect(page.getByText('今週の献立: なし')).toBeVisible()
    await expect(page.getByText('イベント: なし')).toBeVisible()
    await expect(page.getByRole('heading', { name: '今月のお金' })).toBeVisible()
    await expect(page.getByText('イベント別支出: なし')).toBeVisible()
  })

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
    await expect(page.getByText('[E2E_TEST] ダッシュボードイベント', { exact: true })).toBeVisible()

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

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '今日の状況' })).toBeVisible()
    await expect(page.getByText('収支: -1200円')).toBeVisible()
    await expect(page.getByText('今週の献立: [E2E_TEST] ダッシュボード献立')).toBeVisible()
    await expect(page.getByText('イベント: [E2E_TEST] ダッシュボードイベント')).toBeVisible()
    await expect(page.getByText('個人支出: 1200円')).toBeVisible()
    const eventPeriod = page.getByLabel('イベント別支出（対象期間）')
    await expect(eventPeriod).toHaveValue('year')
    await eventPeriod.selectOption('month')
    await expect(eventPeriod).toHaveValue('month')

    await page.getByRole('link', { name: '精算一覧を見る' }).click()
    await expect(page).toHaveURL(/\/warikan$/)
    await page.goto('/')
    await page.getByRole('link', { name: 'イベント一覧を見る' }).click()
    await expect(page).toHaveURL(/\/events$/)
  })
})
