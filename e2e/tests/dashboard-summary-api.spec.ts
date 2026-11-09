import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { addTransaction, setupUserWithHousehold } from './support/flows'

test.describe('S-04 ダッシュボード集計API', () => {
  test('データがない新規世帯でも今日の状況と今月のお金を表示できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'dashboard_empty')

    await expect(page.getByRole('heading', { name: '今日の状況' })).toBeVisible()
    const today = page.locator('.dashboard-today-card')
    await expect(today.getByRole('button', { name: '今週の献立 0件', exact: true })).toBeVisible()
    await expect(today.getByRole('button', { name: 'イベント 0件', exact: true })).toBeVisible()
    await expect(today).not.toContainText('収支:')
    await today.getByRole('button', { name: '今週の献立 0件', exact: true }).click()
    const day = page.getByRole('dialog', { name: '日次詳細', exact: true })
    await day.getByRole('button', { name: /^収支 0件/ }).click()
    await expect(day.locator('.day-finance-summary p').filter({ hasText: '収支' })).toContainText('0円')
    await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).click()
    await expect(page.getByRole('heading', { name: '今月のお金' })).toBeVisible()
    await expect(page.getByText('イベント別支出: なし')).toBeVisible()
  })

  test('本人の収支・今週の献立・当日イベントを実プロセス経由で返す', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'dashboard_api')
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await page.goto('/kakeibo')
    await addTransaction(page, '支出', 1200, '[E2E_TEST] ダッシュボード支出', { date: jstToday })

    await page.goto('/recipes')
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill('[E2E_TEST] ダッシュボード献立')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await page.goto('/menu')
    const menuAddTrigger = page.getByTestId('menu-panel').getByRole('button', { name: 'レシピを追加', exact: true })
    const menuAddSheet = page.getByRole('dialog', { name: 'レシピを追加', exact: true })
    await menuAddTrigger.click()
    const candidate = menuAddSheet.getByRole('checkbox', { name: '[E2E_TEST] ダッシュボード献立', exact: true })
    await candidate.check()
    const recipeId = Number(await candidate.inputValue())
    expect(recipeId).toBeGreaterThan(0)
    await menuAddSheet.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '[E2E_TEST] ダッシュボード献立' })).toBeVisible()
    await expect(menuAddSheet).toBeHidden()
    await menuAddTrigger.click()
    await menuAddSheet.getByLabel('自由メモ', { exact: true }).check()
    await menuAddSheet.getByLabel('自由メモの内容').fill('[E2E_TEST] 外食')
    await menuAddSheet.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '[E2E_TEST] 外食' })).toBeVisible()

    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill('[E2E_TEST] ダッシュボードイベント')
    await page.getByLabel('日付').fill(jstToday)
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByText('[E2E_TEST] ダッシュボードイベント', { exact: true })).toBeVisible()

    const accessToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    expect(accessToken).toBeTruthy()
    await expect.poll(async () => {
      const summaryResponse = await page.request.get('/api/dashboard/summary', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!summaryResponse.ok()) return []
      const summary = await summaryResponse.json<{ weeklyMenuEntries: { recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null }[] }>()
      return summary.weeklyMenuEntries
    }, { timeout: 5_000 }).toContainEqual({ recipeId, recipeTitle: '[E2E_TEST] ダッシュボード献立', freeTextMemo: null })
    const response = await page.request.get('/api/dashboard/summary', { headers: { Authorization: `Bearer ${accessToken}` } })
    expect(response.ok()).toBeTruthy()
    const body = await response.json<{
      todayBalance: number
      monthlyPersonalExpense: number
      weeklyMenuEntries: { recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null }[]
      todayEvents: { name: string; recurrenceType: string }[]
    }>()
    expect(body.todayBalance).toBe(-1200)
    expect(body.monthlyPersonalExpense).toBe(1200)
    expect(body.weeklyMenuEntries).toEqual([
      { recipeId, recipeTitle: '[E2E_TEST] ダッシュボード献立', freeTextMemo: null },
      { recipeId: null, recipeTitle: null, freeTextMemo: '[E2E_TEST] 外食' },
    ])
    expect(body.todayEvents).toContainEqual({ name: '[E2E_TEST] ダッシュボードイベント', recurrenceType: 'none' })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '今日の状況' })).toBeVisible()
    const today = page.locator('.dashboard-today-card')
    const weeklyTrigger = today.getByRole('button', { name: '今週の献立 2件', exact: true })
    await expect(weeklyTrigger).toBeVisible()
    await expect(today.getByRole('button', { name: 'イベント 1件', exact: true })).toBeVisible()
    await weeklyTrigger.click()
    const day = page.getByRole('dialog', { name: '日次詳細', exact: true })
    for (const label of ['今週の献立', 'イベント', '収支']) await day.getByRole('button', { name: new RegExp('^' + label + '.*件') }).click()
    await expect(day.locator('.day-finance-summary p').filter({ hasText: '収支' })).toContainText(/-1,?200円/)
    await expect(day.getByRole('region', { name: '今週の献立', exact: true })).toContainText('[E2E_TEST] ダッシュボード献立')
    await expect(day.getByRole('region', { name: 'イベント', exact: true })).toContainText('[E2E_TEST] ダッシュボードイベント')
    await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).click()
    await expect(page.getByText('個人支出: 1200円')).toBeVisible()
    const eventPeriod = page.getByLabel('イベント別支出（対象期間）')
    await expect(eventPeriod).toHaveValue('year')
    await eventPeriod.selectOption('month')
    await expect(eventPeriod).toHaveValue('month')

    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
      await weeklyTrigger.click()
      await day.getByRole('button', { name: /^今週の献立 2件/ }).click()
      await expect(day.getByRole('region', { name: '今週の献立', exact: true })).toContainText('[E2E_TEST] 外食')
      await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      if (process.env.ISSUE_230_SHOTS_DIR) {
        await mkdir(process.env.ISSUE_230_SHOTS_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.ISSUE_230_SHOTS_DIR, `dashboard-${width}.png`), fullPage: true })
      }
    }

    await page.getByRole('link', { name: '精算一覧を見る' }).click()
    await expect(page).toHaveURL(/\/warikan$/)
    await page.goto('/')
    await page.getByRole('link', { name: 'イベント一覧を見る' }).click()
    await expect(page).toHaveURL(/\/events$/)
  })
  test('イベント別支出をtoday・month・yearの期間で返し、未知の期間は400を返す', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'dashboard_event_period')
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const eventName = '[E2E_TEST] 期間別イベント'

    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill(eventName)
    await page.getByLabel('日付').fill(jstToday)
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('events-panel').locator('.list-row-button').filter({ hasText: eventName })).toBeVisible()

    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '収支を登録', exact: true }).click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByRole('tab', { name: '支出' }).click()
    const transactionSettings = modal.getByRole('button', { name: 'その他の設定', exact: true })
    if (await transactionSettings.getAttribute('aria-expanded') !== 'true') await transactionSettings.click()
    await modal.getByLabel('イベント（任意）').selectOption({ label: eventName })
    await modal.getByLabel('金額').fill('800')
    await modal.getByLabel('使用用途（任意）').fill('[E2E_TEST] 期間別支出')
    await modal.getByLabel('日時').fill(jstToday)
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()

    const accessToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    const headers = { Authorization: `Bearer ${accessToken}` }
    for (const period of ['today', 'month', 'year']) {
      const response = await page.request.get(`/api/dashboard/summary?eventPeriod=${period}`, { headers })
      expect(response.ok()).toBeTruthy()
      const body = await response.json<{ eventExpenseSummaries: { eventId: number; name: string; total: number }[] }>()
      expect(body.eventExpenseSummaries).toEqual([{ eventId: expect.any(Number), name: eventName, total: 800 }])
    }
    expect((await page.request.get('/api/dashboard/summary?eventPeriod=week', { headers })).status()).toBe(400)
  })
})
