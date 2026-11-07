import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

function weekOf(value: string) {
  const day = new Date(value + 'T00:00:00Z')
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}
async function expand(dialog: Locator, label: string) {
  const toggle = dialog.getByRole('button', { name: new RegExp('^' + label + ' [0-9]+件') })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const id = await toggle.getAttribute('aria-controls')
  expect(id).toBeTruthy()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const region = dialog.locator('[id="' + id + '"]')
  await expect(region).toBeVisible()
  return region
}
async function focusedInside(page: Page, dialog: Locator) {
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    const rect = await page.evaluate(() => {
      const box = document.activeElement?.getBoundingClientRect()
      return box ? { top: box.top, bottom: box.bottom } : null
    })
    expect(rect).not.toBeNull()
    expect(rect!.top).toBeGreaterThanOrEqual(0)
    expect(rect!.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
  }
}
async function fits(page: Page, dialog?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  if (dialog) expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
}

for (const width of [1280, 390, 320]) {
  test.describe(width + 'px 日付詳細 #431', () => {
    test.use({ viewport: { width, height: width === 1280 ? 900 : 844 }, hasTouch: width < 500 })
    test('4カテゴリと実績・予定を分け、入れ子詳細から戻り全閉鎖経路を操作できる', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'day_detail_ui_' + width)
      const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
      const jst = new Date(Date.now() + 9 * 3600000)
      const date = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
      const post = async (path: string, data: unknown) => {
        const response = await page.request.post('/api/' + path, { headers, data })
        expect(response.status()).toBe(201)
        return response.json()
      }
      const account = await post('accounts', { name: '[E2E_TEST] 詳細入金口座', type: 'bank', balance: 0 })
      const incomeCategories = await (await page.request.get('/api/income-categories', { headers })).json()
      const expenseCategories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
      await post('incomes', { incomeDate: date, amount: 100000, content: '[E2E_TEST] 日付詳細収入', categoryId: incomeCategories[0].id, accountId: account.id })
      await post('expenses', { expenseDate: date, amount: 2000, purpose: '[E2E_TEST] 日付詳細支出', categoryId: expenseCategories[0].id })
      await post('fixed-costs', { name: '[E2E_TEST] 予定額は実績に加えない', amount: 80000, paymentDay: Number(date.slice(-2)), personal: true })
      const eventName = '[E2E_TEST] 日付詳細イベント0長い名前の確認'
      for (let index = 0; index < 12; index++) await post('events', { name: index === 0 ? eventName : '[E2E_TEST] 日付詳細イベント' + index + '長い名前の確認', eventDate: date, personal: false })
      const recipeTitle = '[E2E_TEST] 日付詳細の長いレシピ' + 'abcdefgh'.repeat(8)
      const recipe = await post('recipes', { title: recipeTitle, sourceType: 'manual', ingredients: '[E2E_TEST] 材料', steps: Array.from({ length: 8 }, (_, i) => (i + 1) + '. [E2E_TEST] ' + '長い手順'.repeat(30)).join('\n') })
      await post('menu-entries', { recipeId: recipe.id, weekStartDate: weekOf(date) })
      await post('menu-entries', { freeTextMemo: '[E2E_TEST] 選択週の自由メモ', weekStartDate: weekOf(date) })
      await page.goto('/')
      await page.getByRole('button', { name: '次月', exact: true }).click()
      const cell = page.getByRole('button', { name: new RegExp('^' + date) })
      await expect(cell).toHaveAccessibleName(new RegExp(date + '.*イベント.*収入.*支出.*固定費'))
      expect(await cell.locator('.calendar-dot').evaluateAll(dots => dots.map(dot => dot.getAttribute('data-category')))).toEqual(['events', 'income', 'expense', 'fixed'])
      await expect(page.locator('.calendar-legend .calendar-dot')).toHaveCount(4)
      await expect(page.locator('.calendar-legend > li')).toHaveText(['イベント', '収入', '支出', '固定費'])
      await expect(page.locator('.calendar-weekdays').locator(':scope > *')).toHaveCount(7)
      await expect(cell).not.toContainText('80000')
      await expect(cell).not.toContainText(eventName)
      const cellBox = await cell.boundingBox()
      expect(cellBox!.height).toBeGreaterThanOrEqual(44)
      expect(await page.locator('.calendar-day-date').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true)
      await fits(page)
      if (process.env.DAY_DETAIL_SCREENSHOT_DIR) {
        await mkdir(process.env.DAY_DETAIL_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.DAY_DETAIL_SCREENSHOT_DIR, 'calendar-' + width + '.png') })
      }
      const calendarColumns = await page.locator('.calendar-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      expect(calendarColumns).toBe(7)
      await cell.focus()
      const originalScroll = await page.evaluate(() => window.scrollY)
      await cell.press('Enter')
      const day = page.getByRole('dialog', { name: '日次詳細', exact: true, includeHidden: true })
      await expect(day).toBeVisible()
      const labels = ['今週の献立', 'イベント', '収支', '固定費']
      for (const label of labels) await expect(day.getByRole('button', { name: new RegExp('^' + label + ' [0-9]+件') })).toHaveAttribute('aria-expanded', 'false')
      for (const label of labels) {
        const box = await day.getByRole('button', { name: new RegExp('^' + label + ' [0-9]+件') }).boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
      const closeBox = await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).boundingBox()
      expect(closeBox!.width).toBeGreaterThanOrEqual(44)
      expect(closeBox!.height).toBeGreaterThanOrEqual(44)
      const menu = await expand(day, labels[0])
      const events = await expand(day, labels[1])
      const finance = await expand(day, labels[2])
      const fixed = await expand(day, labels[3])
      await expect(menu).toContainText('[E2E_TEST] 選択週の自由メモ')
      await expect(menu.getByRole('link', { name: 'この週の献立を編集' })).toHaveAttribute('href', '/menu?week=' + weekOf(date))
      await expect(finance).toContainText(/100,?000円/)
      await expect(finance).toContainText(/2,?000円/)
      await expect(finance).toContainText(/98,?000円/)
      await expect(fixed).toContainText(/80,?000円/)
      await expect(fixed).toContainText('計上予定')
      await expect(day.getByRole('button', { name: /^今週の献立 [0-9]+件/ })).toContainText('2件')
      await expect(day.getByRole('button', { name: /^イベント [0-9]+件/ })).toContainText('12件')
      await expect(day.getByRole('button', { name: /^収支 [0-9]+件/ })).toContainText('2件')
      await expect(day.getByRole('button', { name: /^固定費 [0-9]+件/ })).toContainText('1件')
      const eventTrigger = events.getByRole('button').filter({ hasText: eventName })
      await eventTrigger.click()
      const event = page.getByRole('dialog', { name: 'イベント詳細', exact: true })
      await expect(event).toBeVisible()
      await expect(event).toContainText(eventName)
      await expect(day.locator('[role="dialog"]')).toHaveCount(0)
      await focusedInside(page, event)
      await page.keyboard.press('Escape')
      await expect(event).toBeHidden()
      await expect(day).toBeVisible()
      await expect(eventTrigger).toBeFocused()
      expect(await page.evaluate(() => document.body.style.position)).toBe('fixed')
      await page.keyboard.press('Escape')
      await expect(day).toBeHidden()
      await expect(cell).toBeFocused()
      expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed')
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(originalScroll, 0)

      await cell.click()
      const reopenedMenu = await expand(day, '今週の献立')
      const recipeTrigger = reopenedMenu.getByRole('button').filter({ hasText: recipeTitle })
      await recipeTrigger.click()
      const detail = page.getByRole('dialog', { name: 'レシピ詳細', exact: true })
      await expect(detail.getByRole('heading', { name: recipeTitle })).toBeVisible()
      await expect(detail.getByRole('heading', { name: recipeTitle })).toBeInViewport()
      await expect(detail.getByRole('button', { name: 'レシピ詳細を閉じる', exact: true })).toBeFocused()
      expect(await detail.locator('.recipe-detail-modal').evaluate(el => el.scrollTop)).toBe(0)
      await expect(detail.getByRole('button', { name: '編集', exact: true })).toHaveCount(0)
      await expect(detail.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
      await focusedInside(page, detail)
      await page.keyboard.press('Escape')
      await expect(detail).toBeHidden()
      await expect(day).toBeVisible()
      await expect(recipeTrigger).toBeFocused()
      await expect(day.getByRole('button', { name: /^今週の献立 [0-9]+件/ })).toHaveAttribute('aria-expanded', 'true')
      await expand(day, 'イベント')
      await expand(day, '収支')
      await expand(day, '固定費')
      await fits(page, day)
      expect(await day.locator('.day-detail-body').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      const footer = day.getByRole('button', { name: '閉じる', exact: true })
      expect(await footer.evaluate(el => getComputedStyle(el).position)).not.toMatch(/fixed|sticky/)
      await footer.scrollIntoViewIfNeeded()
      await expect(day.getByRole('button', { name: '日付詳細を閉じる', exact: true })).toBeInViewport()
      if (process.env.DAY_DETAIL_SCREENSHOT_DIR) {
        await mkdir(process.env.DAY_DETAIL_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.DAY_DETAIL_SCREENSHOT_DIR, 'expanded-' + width + '.png') })
      }
      await footer.click()
      await expect(day).toBeHidden()
      await expect(cell).toBeFocused()
      await cell.click()
      await day.getByRole('heading', { name: new RegExp(date) }).click()
      await expect(day).toBeVisible()
      await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).click()
      await expect(day).toBeHidden()
      await expect(cell).toBeFocused()
      await cell.click()
      await page.locator('.modal-overlay').last().click({ position: { x: 2, y: 2 } })
      await expect(day).toBeHidden()
      await expect(cell).toBeFocused()
      if (width === 390) {
        await page.goto('/settings/display')
        const settings = page.getByRole('group', { name: 'カレンダー', exact: true })
        for (const label of ['イベント', '収入', '支出']) await settings.getByLabel(label, { exact: true }).uncheck()
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page).toHaveURL(/\/$/)
        await page.getByRole('button', { name: '次月', exact: true }).click()
        await expect(cell).toHaveAccessibleName(new RegExp(date + '.*固定費'))
        await expect(cell).not.toHaveAccessibleName(/イベント|収入|支出/)
        await cell.click()
        const hiddenEvents = await expand(day, 'イベント')
        const hiddenFinance = await expand(day, '収支')
        await expect(hiddenEvents).toContainText(eventName)
        await expect(hiddenFinance).toContainText(/100,?000円/)
        await expect(hiddenFinance).toContainText(/2,?000円/)
        await day.getByRole('button', { name: '閉じる', exact: true }).click()
      }
    })
  })
}

function emptyDetail(date: string) {
  return { date, weekStartDate: weekOf(date), menuEntries: [] as { id: number; recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null; weekStartDate: string }[], events: [], finance: { income: 0, expense: 0, balance: 0, incomes: [], expenses: [] }, fixedCosts: [] }
}

test('390px: API表示fixtureの六状態と実績82000円を、予定額・決済完了と混同しない (#431)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'day_detail_state_ui')
  const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const statuses = ['posted', 'scheduled', 'missing', 'suppressed', 'not_applicable', 'unknown']
  // 状態分類は#446の実DBテスト担当。この応答はenum→表示と金額の区別だけを検証する。
  const fixture = {
    ...emptyDetail(date),
    finance: { income: 0, expense: 82000, balance: -82000, incomes: [], expenses: [
      { id: 701, expenseDate: date, amount: 80000, purpose: '[E2E_TEST] 固定費実績', fixedCostId: 601, fixedCostYearMonth: date.slice(0, 7) },
      { id: 702, expenseDate: date, amount: 2000, purpose: '[E2E_TEST] 通常支出', fixedCostId: null, fixedCostYearMonth: null },
    ] },
    fixedCosts: statuses.map((postingStatus, index) => ({ id: 601 + index, name: '[E2E_TEST] 表示状態' + postingStatus, amount: index === 0 ? 90000 : 1000, paymentDate: date, yearMonth: date.slice(0, 7), postingStatus, postedExpense: index === 0 ? { id: 701, expenseDate: date, amount: 80000 } : index === 5 ? { id: 799, expenseDate: date, amount: 987654321 } : null })),
  }
  await page.route('**/api/dashboard/day-detail?*', route => route.fulfill({ json: fixture }))
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp('^' + date) }).click()
  const day = page.getByRole('dialog', { name: '日次詳細', exact: true })
  const emptyMenu = await expand(day, '今週の献立')
  const emptyEvents = await expand(day, 'イベント')
  await expect(day.getByRole('button', { name: /^今週の献立 [0-9]+件/ })).toContainText('0件')
  await expect(day.getByRole('button', { name: /^イベント [0-9]+件/ })).toContainText('0件')
  await expect(emptyMenu.getByRole('link', { name: 'この週の献立を編集' })).toBeVisible()
  await expect(emptyEvents.getByRole('link', { name: 'イベントを追加' })).toBeVisible()
  const finance = await expand(day, '収支')
  const fixed = await expand(day, '固定費')
  await expect(finance).toContainText(/82,?000円/)
  await expect(finance).toContainText(/-82,?000円/)
  await expect(finance).toContainText('[E2E_TEST] 通常支出')
  await expect(day.getByRole('button', { name: /^収支 [0-9]+件/ })).toContainText('2件')
  await expect(day.getByRole('button', { name: /^固定費 [0-9]+件/ })).toContainText('6件')
  for (const label of ['支出に計上済み', '計上予定', '計上記録なし', '再計上しない', '計上対象外', '確認できません']) await expect(fixed).toContainText(label)
  await expect(fixed).toContainText(/90,?000円/)
  await expect(fixed).toContainText(/80,?000円/)
  await expect(fixed).toContainText('銀行引き落とし・カード決済・精算の完了ではありません')
  // APIはunknown/nullを保証する。UIも不整合な補助記録から私的実額を補完しない。
  const unknown = fixed.getByRole('listitem').filter({ hasText: '[E2E_TEST] 表示状態unknown' })
  await expect(unknown).toContainText('確認できません')
  await expect(unknown).toContainText(/1,?000円/)
  await expect(unknown).not.toContainText('計上記録:')
  await expect(day).not.toContainText(/987,?654,?321/)
  await fits(page, day)
})

test('390px: 日付詳細の取得失敗を空成功にせず、再試行と閉鎖後の旧応答破棄を行う (#431)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'day_detail_race_ui')
  const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)
  const a = month + '-15', b = month + '-16'
  let aRequests = 0
  let releaseA = () => {}
  let finishedA = () => {}
  const heldA = new Promise<void>(resolve => { releaseA = resolve })
  const completedA = new Promise<void>(resolve => { finishedA = resolve })
  consoleGuard.allow({ url: new RegExp('/api/dashboard/day-detail[?]date=' + a + '$'), message: /^Failed to load resource:.*500/ })
  await page.route('**/api/dashboard/day-detail?*', async route => {
    const date = new URL(route.request().url()).searchParams.get('date')!
    if (date === a && ++aRequests === 1) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })
    const fixture = emptyDetail(date)
    fixture.menuEntries = [{ id: date === a ? 801 : 802, recipeId: null, recipeTitle: null, freeTextMemo: date === a ? '[E2E_TEST] 旧日付A' : '[E2E_TEST] 新日付B', weekStartDate: weekOf(date) }]
    if (date === a) {
      await heldA
      try { await route.fulfill({ json: fixture }) } catch { /* 閉鎖時に中止された要求は再送しない。 */ } finally { finishedA() }
    } else await route.fulfill({ json: fixture })
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp('^' + a) }).click()
    const day = page.getByRole('dialog', { name: '日次詳細', exact: true })
    await expect(day.getByRole('alert')).toBeVisible()
    await expect(day).not.toContainText('0件')
    await expect(day).not.toContainText('0円')
    await day.getByRole('button', { name: /再試行/ }).click()
    await expect.poll(() => aRequests).toBe(2)
    await expect(day).not.toContainText('0件')
    await day.getByRole('button', { name: '日付詳細を閉じる', exact: true }).click()
    await expect(day).toBeHidden()
    await page.getByRole('button', { name: new RegExp('^' + b) }).click()
    const menu = await expand(day, '今週の献立')
    await expect(menu).toContainText('[E2E_TEST] 新日付B')
    const emptyFinance = await expand(day, '収支')
    await expect(day.getByRole('button', { name: /^収支 0件/ })).toBeVisible()
    await expect(emptyFinance).toContainText(/0円/)
    releaseA()
    await completedA
    await expect(menu).toContainText('[E2E_TEST] 新日付B')
    await expect(day).not.toContainText('[E2E_TEST] 旧日付A')
  } finally { releaseA() }
})

test('390px: 後から選んだイベントを遅いレシピ応答が上書きせず、元行へ戻って再照会できる (#431)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'day_detail_child_race')
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
  const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data })
    expect(response.status()).toBe(201)
    return response.json()
  }
  const title = '[E2E_TEST] 後着レシピ'
  const eventName = '[E2E_TEST] 後から選択したイベント'
  const recipe = await post('recipes', { title, sourceType: 'manual' })
  await post('menu-entries', { recipeId: recipe.id, weekStartDate: weekOf(date) })
  await post('events', { name: eventName, eventDate: date, personal: false })
  let requests = 0
  let firstStarted = false
  let release = () => {}
  let settled = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const finished = new Promise<void>(resolve => { settled = resolve })
  await page.route('**/api/recipes', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    if (++requests > 1) return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    firstStarted = true
    await held
    try { await route.fulfill({ response }) } catch { /* Event選択により中止済みなら遅い応答を再送しない。 */ } finally { settled() }
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp('^' + date) }).click()
    const day = page.getByRole('dialog', { name: '日次詳細', exact: true, includeHidden: true })
    const menu = await expand(day, '今週の献立')
    const events = await expand(day, 'イベント')
    const recipeRow = menu.getByRole('button').filter({ hasText: title })
    const eventRow = events.getByRole('button').filter({ hasText: eventName })
    await recipeRow.click()
    await expect.poll(() => firstStarted).toBe(true)
    await expect(recipeRow).toBeDisabled()
    await eventRow.click()
    const event = page.getByRole('dialog', { name: 'イベント詳細', exact: true })
    await expect(event).toContainText(eventName)
    release()
    await finished
    await page.keyboard.press('Tab')
    await expect(event).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'レシピ詳細', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(event).toBeHidden()
    await expect(eventRow).toBeFocused()
    await expect(recipeRow).toBeEnabled()
    await recipeRow.click()
    await expect(page.getByRole('dialog', { name: 'レシピ詳細', exact: true })).toContainText(title)
    expect(requests).toBe(2)
    await page.keyboard.press('Escape')
    await expect(recipeRow).toBeFocused()
  } finally { release() }
})
