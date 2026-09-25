import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatJstToday, getJstToday } from '../../lib/date'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_split_comments'),
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM menu_entries'),
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM incomes'),
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM fixed_costs'),
    env.DB.prepare('DELETE FROM shopping_list_items'),
    env.DB.prepare('DELETE FROM inventory_items'),
    env.DB.prepare('DELETE FROM zaiko_categories'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM income_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ userId: number; householdId: number; headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `CODE${user.id}00000000000`.slice(0, 16))
    .first<{ id: number }>()
  if (!household) throw new Error('test setup error')
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)')
    .bind(household.id, user.id)
    .run()
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, householdId: household.id, headers: { Authorization: `Bearer ${token}` } }
}

async function createInventoryItem(householdId: number, quantityTenths: number, thresholdTenths: number): Promise<void> {
  const category = await env.DB.prepare(
    "INSERT INTO zaiko_categories (household_id, name, is_default) VALUES (?, 'テストカテゴリー', 0) RETURNING id",
  )
    .bind(householdId)
    .first<{ id: number }>()
  if (!category) throw new Error('test setup error')
  await env.DB.prepare(
    'INSERT INTO inventory_items (household_id, name, category_id, quantity_tenths, threshold_tenths) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(householdId, '在庫アイテム', category.id, quantityTenths, thresholdTenths)
    .run()
}

async function createShoppingListItem(householdId: number, inventoryItemId: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO shopping_list_items (household_id, inventory_item_id, is_manual) VALUES (?, ?, 1)',
  )
    .bind(householdId, inventoryItemId)
    .run()
}

async function createExpense(params: { householdId: number; userId: number; amount: number; expenseDate: string; includeInHouseholdTotal: boolean }): Promise<void> {
  const category = await env.DB.prepare(
    "INSERT INTO kakeibo_categories (household_id, name, is_default) VALUES (?, 'テストカテゴリー', 0) RETURNING id",
  )
    .bind(params.householdId)
    .first<{ id: number }>()
  if (!category) throw new Error('test setup error')
  await env.DB.prepare(
    `INSERT INTO expenses (household_id, payer_user_id, category_id, amount, purpose, expense_date, include_in_household_total)
     VALUES (?, ?, ?, ?, 'テスト支出', ?, ?)`,
  )
    .bind(params.householdId, params.userId, category.id, params.amount, params.expenseDate, params.includeInHouseholdTotal ? 1 : 0)
    .run()
}

async function createFixedCost(params: { householdId: number; userId: number; amount: number; includeInHouseholdTotal: boolean }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO fixed_costs (household_id, created_by_user_id, name, amount, payment_day, include_in_household_total)
     VALUES (?, ?, 'テスト固定費', ?, 1, ?)`,
  )
    .bind(params.householdId, params.userId, params.amount, params.includeInHouseholdTotal ? 1 : 0)
    .run()
}

async function createIncome(params: { householdId: number; userId: number; amount: number; incomeDate: string }): Promise<void> {
  const category = await env.DB.prepare(
    "INSERT INTO income_categories (household_id, name, is_default) VALUES (?, 'テスト収入カテゴリー', 0) RETURNING id",
  )
    .bind(params.householdId)
    .first<{ id: number }>()
  if (!category) throw new Error('test setup error')
  await env.DB.prepare(
    `INSERT INTO incomes (household_id, earner_user_id, category_id, amount, content, income_date)
     VALUES (?, ?, ?, ?, 'テスト収入', ?)`,
  )
    .bind(params.householdId, params.userId, category.id, params.amount, params.incomeDate)
    .run()
}

async function createEvent(params: {
  householdId: number
  ownerUserId: number | null
  createdByUserId: number
  name: string
  eventDate: string
  recurrenceType: string
  notifyEnabled?: boolean
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type, notify_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.householdId,
      params.ownerUserId,
      params.createdByUserId,
      params.name,
      params.eventDate,
      params.recurrenceType,
      params.notifyEnabled ? 1 : 0,
    )
    .run()
}

async function createCalendarFixedCost(params: {
  householdId: number
  ownerUserId: number | null
  createdByUserId: number
  name: string
  paymentDay: number
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO fixed_costs (household_id, owner_user_id, created_by_user_id, name, amount, payment_day)
     VALUES (?, ?, ?, ?, 1000, ?)`,
  )
    .bind(params.householdId, params.ownerUserId, params.createdByUserId, params.name, params.paymentDay)
    .run()
}

async function createExpenseWithId(params: {
  householdId: number
  userId: number
  amount: number
  expenseDate: string
  eventId?: number
}): Promise<number> {
  const category = await env.DB.prepare(
    "INSERT INTO kakeibo_categories (household_id, name, is_default) VALUES (?, '集計テストカテゴリー', 0) RETURNING id",
  )
    .bind(params.householdId)
    .first<{ id: number }>()
  if (!category) throw new Error('test setup error')
  const expense = await env.DB.prepare(
    `INSERT INTO expenses (household_id, payer_user_id, category_id, event_id, amount, purpose, expense_date, include_in_household_total)
     VALUES (?, ?, ?, ?, ?, '集計テスト支出', ?, 0) RETURNING id`,
  )
    .bind(params.householdId, params.userId, category.id, params.eventId ?? null, params.amount, params.expenseDate)
    .first<{ id: number }>()
  if (!expense) throw new Error('test setup error')
  return expense.id
}

async function createDashboardEvent(params: {
  householdId: number
  ownerUserId: number | null
  createdByUserId: number
  name: string
  eventDate: string
  showOnDashboard?: boolean
}): Promise<number> {
  const event = await env.DB.prepare(
    `INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type, show_on_dashboard)
     VALUES (?, ?, ?, ?, ?, 'none', ?) RETURNING id`,
  )
    .bind(params.householdId, params.ownerUserId, params.createdByUserId, params.name, params.eventDate, params.showOnDashboard ?? true ? 1 : 0)
    .first<{ id: number }>()
  if (!event) throw new Error('test setup error')
  return event.id
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`
}

function currentWeekStart(): string {
  const today = getJstToday()
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return formatDate(monday)
}

beforeEach(async () => {
  await resetDb()
})

describe('GET /api/dashboard/summary', () => {
  it('世帯未所属の場合は404を返す', async () => {
    const user = await env.DB.prepare(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
    )
      .bind('taro@example.com', 'dummy-hash', 'テスト太郎')
      .first<{ id: number }>()
    if (!user) throw new Error('test setup error')
    const token = await signAccessToken(user.id, env.JWT_SECRET, 900)

    const res = await app.request('/api/dashboard/summary', { headers: { Authorization: `Bearer ${token}` } }, env)

    expect(res.status).toBe(404)
  })

  it('買い物リスト件数・低在庫件数が0件のとき、それぞれ0を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ shoppingListCount: number; lowStockCount: number; householdExpenseTotal: number }>()
    expect(body.shoppingListCount).toBe(0)
    expect(body.lowStockCount).toBe(0)
    expect(body.householdExpenseTotal).toBe(0)
  })

  it('買い物リスト件数を正しくカウントする', async () => {
    const { householdId, headers } = await createUserWithHousehold('taro@example.com')
    const category = await env.DB.prepare(
      "INSERT INTO zaiko_categories (household_id, name, is_default) VALUES (?, 'テストカテゴリー', 0) RETURNING id",
    )
      .bind(householdId)
      .first<{ id: number }>()
    if (!category) throw new Error('test setup error')
    const item1 = await env.DB.prepare(
      'INSERT INTO inventory_items (household_id, name, category_id, quantity_tenths, threshold_tenths) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(householdId, '在庫1', category.id, 10, 5)
      .first<{ id: number }>()
    const item2 = await env.DB.prepare(
      'INSERT INTO inventory_items (household_id, name, category_id, quantity_tenths, threshold_tenths) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(householdId, '在庫2', category.id, 10, 5)
      .first<{ id: number }>()
    if (!item1 || !item2) throw new Error('test setup error')
    await createShoppingListItem(householdId, item1.id)
    await createShoppingListItem(householdId, item2.id)

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    const body = await res.json<{ shoppingListCount: number }>()
    expect(body.shoppingListCount).toBe(2)
  })

  it('quantity_tenths < threshold_tenthsの在庫のみを低在庫としてカウントする', async () => {
    const { householdId, headers } = await createUserWithHousehold('taro@example.com')
    await createInventoryItem(householdId, 5, 10) // 低在庫
    await createInventoryItem(householdId, 10, 10) // 閾値と同値は低在庫に含まない
    await createInventoryItem(householdId, 20, 10) // 閾値超過

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    const body = await res.json<{ lowStockCount: number }>()
    expect(body.lowStockCount).toBe(1)
  })

  it('世帯合計対象フラグがtrueの当月支出・固定費のみを合算する', async () => {
    const { householdId, userId, headers } = await createUserWithHousehold('taro@example.com')
    // JST基準の「今日」を使う(dashboardルートの当月判定もJST基準のため)。
    const today = getJstToday()
    const yearMonth = `${today.getUTCFullYear()}-${(today.getUTCMonth() + 1).toString().padStart(2, '0')}`
    await createExpense({ householdId, userId, amount: 1000, expenseDate: `${yearMonth}-15`, includeInHouseholdTotal: true })
    await createExpense({ householdId, userId, amount: 500, expenseDate: `${yearMonth}-16`, includeInHouseholdTotal: false })
    await createFixedCost({ householdId, userId, amount: 2000, includeInHouseholdTotal: true })
    await createFixedCost({ householdId, userId, amount: 300, includeInHouseholdTotal: false })

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    const body = await res.json<{ householdExpenseTotal: number }>()
    expect(body.householdExpenseTotal).toBe(3000)
  })

  it('当月以外の日付の支出は世帯合計に含めない(前月末・翌月初の境界値)', async () => {
    const { householdId, userId, headers } = await createUserWithHousehold('taro@example.com')
    // JST基準の「今日」を使う(dashboardルートの当月判定もJST基準のため)。
    const today = getJstToday()
    const currentMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const previousMonthLastDay = new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000)
    const nextMonthFirstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
    const format = (date: Date): string =>
      `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`

    await createExpense({ householdId, userId, amount: 999, expenseDate: format(previousMonthLastDay), includeInHouseholdTotal: true })
    await createExpense({ householdId, userId, amount: 888, expenseDate: format(nextMonthFirstDay), includeInHouseholdTotal: true })

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    const body = await res.json<{ householdExpenseTotal: number }>()
    expect(body.householdExpenseTotal).toBe(0)
  })

  it('本人の当日収入から当日支出を引いた収支を返し、他ユーザー・別日分を含めない', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await env.DB.prepare(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
    )
      .bind('hanako@example.com', 'dummy-hash', 'テスト花子')
      .first<{ id: number }>()
    if (!member) throw new Error('test setup error')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(owner.householdId, member.id).run()

    const today = formatJstToday()
    await createIncome({ householdId: owner.householdId, userId: owner.userId, amount: 3000, incomeDate: today })
    await createExpense({ householdId: owner.householdId, userId: owner.userId, amount: 1200, expenseDate: today, includeInHouseholdTotal: false })
    await createIncome({ householdId: owner.householdId, userId: member.id, amount: 9000, incomeDate: today })
    await createExpense({ householdId: owner.householdId, userId: owner.userId, amount: 500, expenseDate: '2000-01-01', includeInHouseholdTotal: false })

    const res = await app.request('/api/dashboard/summary', { headers: owner.headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ todayBalance: number }>()
    expect(body.todayBalance).toBe(1800)
  })

  it('今週の献立は同じ世帯のレシピ名と自由メモだけを返す', async () => {
    const { householdId, userId, headers } = await createUserWithHousehold('taro@example.com')
    const recipe = await env.DB.prepare('INSERT INTO recipes (household_id, created_by_user_id, title) VALUES (?, ?, ?) RETURNING id')
      .bind(householdId, userId, '肉じゃが')
      .first<{ id: number }>()
    if (!recipe) throw new Error('test setup error')
    const weekStartDate = currentWeekStart()
    await env.DB.prepare('INSERT INTO menu_entries (household_id, recipe_id, week_start_date) VALUES (?, ?, ?)').bind(householdId, recipe.id, weekStartDate).run()
    await env.DB.prepare('INSERT INTO menu_entries (household_id, free_text_memo, week_start_date) VALUES (?, ?, ?)')
      .bind(householdId, '外食', weekStartDate)
      .run()
    await env.DB.prepare('INSERT INTO menu_entries (household_id, free_text_memo, week_start_date) VALUES (?, ?, ?)')
      .bind(householdId, '先週の献立', '2000-01-03')
      .run()

    const res = await app.request('/api/dashboard/summary', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ weeklyMenuEntries: { recipeTitle: string | null; freeTextMemo: string | null }[] }>()
    expect(body.weeklyMenuEntries).toEqual([
      { recipeTitle: '肉じゃが', freeTextMemo: null },
      { recipeTitle: null, freeTextMemo: '外食' },
    ])
  })

  it('当日発生する閲覧可能な繰り返しイベントだけを返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await env.DB.prepare(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
    )
      .bind('hanako@example.com', 'dummy-hash', 'テスト花子')
      .first<{ id: number }>()
    if (!member) throw new Error('test setup error')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(owner.householdId, member.id).run()

    const today = formatJstToday()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type) VALUES (?, NULL, ?, ?, ?, ?)')
        .bind(owner.householdId, owner.userId, '共有の習慣', today, 'daily'),
      env.DB.prepare('INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(owner.householdId, owner.userId, owner.userId, '自分の予定', today, 'none'),
      env.DB.prepare('INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(owner.householdId, member.id, member.id, '他人の非公開予定', today, 'daily'),
      env.DB.prepare('INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type) VALUES (?, NULL, ?, ?, ?, ?)')
        .bind(owner.householdId, owner.userId, '過去の単発予定', '2000-01-01', 'none'),
    ])

    const res = await app.request('/api/dashboard/summary', { headers: owner.headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ todayEvents: { name: string; recurrenceType: string }[] }>()
    expect(body.todayEvents).toEqual([
      { name: '共有の習慣', recurrenceType: 'daily' },
      { name: '自分の予定', recurrenceType: 'none' },
    ])
  })
  it('月間の本人支出、未精算の方向別集計、表示対象イベント別支出を返す', async () => {
    const owner = await createUserWithHousehold('summary-money-owner@example.com')
    const member = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
      .bind('summary-money-member@example.com', 'dummy-hash', 'テスト花子')
      .first<{ id: number }>()
    if (!member) throw new Error('test setup error')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(owner.householdId, member.id).run()
    const today = getJstToday()
    const year = today.getUTCFullYear()
    const month = String(today.getUTCMonth() + 1).padStart(2, '0')
    const date = `${year}-${month}-15`
    const ownExpenseId = await createExpenseWithId({ householdId: owner.householdId, userId: owner.userId, amount: 1200, expenseDate: date })
    const memberExpenseId = await createExpenseWithId({ householdId: owner.householdId, userId: member.id, amount: 9000, expenseDate: date })
    await createExpenseWithId({ householdId: owner.householdId, userId: owner.userId, amount: 800, expenseDate: `${year - 1}-12-31` })
    await env.DB.batch([
      env.DB.prepare("INSERT INTO expense_splits (expense_id, debtor_user_id, split_input_type, split_ratio, amount_due, status) VALUES (?, ?, 'amount', 0, 300, 'unpaid')").bind(ownExpenseId, member.id),
      env.DB.prepare("INSERT INTO expense_splits (expense_id, debtor_user_id, split_input_type, split_ratio, amount_due, status) VALUES (?, ?, 'amount', 0, 200, 'requested')").bind(memberExpenseId, owner.userId),
      env.DB.prepare("INSERT INTO expense_splits (expense_id, debtor_user_id, split_input_type, split_ratio, amount_due, status) VALUES (?, ?, 'amount', 0, 400, 'settled')").bind(ownExpenseId, member.id),
    ])
    const visibleEventId = await createDashboardEvent({ householdId: owner.householdId, ownerUserId: null, createdByUserId: owner.userId, name: '表示対象イベント', eventDate: date })
    await createDashboardEvent({ householdId: owner.householdId, ownerUserId: null, createdByUserId: owner.userId, name: '非表示イベント', eventDate: date, showOnDashboard: false })
    await createExpenseWithId({ householdId: owner.householdId, userId: owner.userId, amount: 500, expenseDate: date, eventId: visibleEventId })

    const res = await app.request('/api/dashboard/summary', { headers: owner.headers }, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ monthlyPersonalExpense: number; unsettledReceivable: { count: number; total: number }; unsettledPayable: { count: number; total: number }; eventExpenseSummaries: { eventId: number; name: string; total: number }[] }>()
    expect(body.monthlyPersonalExpense).toBe(1700)
    expect(body.unsettledReceivable).toEqual({ count: 1, total: 300 })
    expect(body.unsettledPayable).toEqual({ count: 1, total: 200 })
    expect(body.eventExpenseSummaries).toEqual([{ eventId: visibleEventId, name: '表示対象イベント', total: 500 }])
  })

  it('eventPeriodはyear/monthだけを受け付け、monthでは当月分だけを集計する', async () => {
    const owner = await createUserWithHousehold('summary-period-owner@example.com')
    const today = getJstToday()
    const year = today.getUTCFullYear()
    const month = String(today.getUTCMonth() + 1).padStart(2, '0')
    const eventId = await createDashboardEvent({ householdId: owner.householdId, ownerUserId: owner.userId, createdByUserId: owner.userId, name: '期間別イベント', eventDate: `${year}-01-01` })
    await createExpenseWithId({ householdId: owner.householdId, userId: owner.userId, amount: 100, expenseDate: `${year}-${month}-01`, eventId })
    await createExpenseWithId({ householdId: owner.householdId, userId: owner.userId, amount: 200, expenseDate: `${year}-01-01`, eventId })

    const monthRes = await app.request('/api/dashboard/summary?eventPeriod=month', { headers: owner.headers }, env)
    expect(monthRes.status).toBe(200)
    expect((await monthRes.json<{ eventExpenseSummaries: { eventId: number; name: string; total: number }[] }>()).eventExpenseSummaries).toEqual([
      { eventId, name: '期間別イベント', total: 100 },
    ])
    expect((await app.request('/api/dashboard/summary?eventPeriod=week', { headers: owner.headers }, env)).status).toBe(400)
  })
})

describe('GET /api/dashboard/calendar', () => {
  it('monthが実在するYYYY-MM形式でない場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('calendar-invalid@example.com')

    for (const month of ['', '2026-2', '2026-13', '2026-00', 'invalid']) {
      const res = await app.request(`/api/dashboard/calendar?month=${month}`, { headers }, env)
      expect(res.status).toBe(400)
    }
  })

  it('月末補正した固定費、繰り返しイベント、本人の日別収支を返す', async () => {
    const owner = await createUserWithHousehold('calendar-owner@example.com')
    await createCalendarFixedCost({
      householdId: owner.householdId,
      ownerUserId: null,
      createdByUserId: owner.userId,
      name: '月末の家賃',
      paymentDay: 31,
    })
    await createEvent({
      householdId: owner.householdId,
      ownerUserId: null,
      createdByUserId: owner.userId,
      name: '毎週の予定',
      eventDate: '2026-01-02',
      recurrenceType: 'weekly',
    })
    await createIncome({ householdId: owner.householdId, userId: owner.userId, amount: 5000, incomeDate: '2026-02-06' })
    await createExpense({ householdId: owner.householdId, userId: owner.userId, amount: 1200, expenseDate: '2026-02-06', includeInHouseholdTotal: false })

    const res = await app.request('/api/dashboard/calendar?month=2026-02', { headers: owner.headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{
      days: { date: string; fixedCosts: string[]; events: { name: string; isRecurring: boolean }[]; balance: number }[]
      notificationCount: number
    }>()
    expect(body.days).toHaveLength(28)
    expect(body.days.find((day) => day.date === '2026-02-28')).toMatchObject({ fixedCosts: ['月末の家賃'] })
    expect(body.days.find((day) => day.date === '2026-02-06')).toMatchObject({
      events: [{ name: '毎週の予定', isRecurring: true }],
      balance: 3800,
    })
  })

  it('他人の個人データを除外し、当日の通知有効イベント発生件数を返す', async () => {
    const owner = await createUserWithHousehold('calendar-visibility@example.com')
    const member = await env.DB.prepare(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
    )
      .bind('calendar-member@example.com', 'dummy-hash', 'テスト花子')
      .first<{ id: number }>()
    if (!member) throw new Error('test setup error')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(owner.householdId, member.id).run()
    await createCalendarFixedCost({
      householdId: owner.householdId,
      ownerUserId: member.id,
      createdByUserId: member.id,
      name: '他人の個人固定費',
      paymentDay: 1,
    })
    await createEvent({
      householdId: owner.householdId,
      ownerUserId: member.id,
      createdByUserId: member.id,
      name: '他人の個人予定',
      eventDate: '2026-02-01',
      recurrenceType: 'none',
    })
    await createEvent({
      householdId: owner.householdId,
      ownerUserId: null,
      createdByUserId: owner.userId,
      name: '共有の毎日通知',
      eventDate: '2000-01-01',
      recurrenceType: 'daily',
      notifyEnabled: true,
    })

    const today = formatJstToday()
    const month = today.slice(0, 7)
    const res = await app.request(`/api/dashboard/calendar?month=${month}`, { headers: owner.headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{
      days: { fixedCosts: string[]; events: { name: string }[] }[]
      notificationCount: number
    }>()
    expect(body.days.flatMap((day) => day.fixedCosts)).not.toContain('他人の個人固定費')
    expect(body.days.flatMap((day) => day.events.map((event) => event.name))).not.toContain('他人の個人予定')
    expect(body.notificationCount).toBe(1)
  })
})
