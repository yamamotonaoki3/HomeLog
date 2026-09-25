import { and, eq, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { events, fixedCosts, menuEntries, recipes } from '../db/schema'
import { currentMonthRange, currentWeekStart, formatJstToday, getJstToday, isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { resolveOccurrences, type RecurrenceType } from '../lib/event-recurrence'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

export const dashboardRoute = new Hono<AppEnv>()

dashboardRoute.use('*', requireAuth)

dashboardRoute.get('/summary', async (c) => {
  const eventPeriod = c.req.query('eventPeriod') ?? 'year'
  if (eventPeriod !== 'year' && eventPeriod !== 'month') {
    return c.json(errorResponse('VALIDATION_ERROR', 'eventPeriodはyearまたはmonthを指定してください'), 400)
  }
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 買い物リスト件数(既存JavaのShoppingListItemMapper.countByHouseholdIdと同じ)。
  const shoppingListCountRow = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM shopping_list_items WHERE household_id = ?')
    .bind(householdId)
    .first<{ count: number }>()

  // 低在庫件数(既存JavaのInventoryItemMapper.countBelowThresholdのtenths版)。
  const lowStockCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM inventory_items WHERE household_id = ? AND quantity_tenths < threshold_tenths',
  )
    .bind(householdId)
    .first<{ count: number }>()

  // 世帯支出サマリー(F-12、新規実装)。当月(JST基準)のexpenses・fixed_costsのうち
  // include_in_household_total=trueのものを合算する(F05_kakeibo_fixedcost.md 7-2章参照。
  // fixed_costsは実際の計上有無に関わらず、登録されている固定費そのものを毎月の見込みとして合算する)。
  const jstToday = getJstToday()
  const { monthStart, nextMonthStart } = currentMonthRange(jstToday)
  const expenseTotalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE household_id = ? AND include_in_household_total = 1 AND expense_date >= ? AND expense_date < ?`,
  )
    .bind(householdId, monthStart, nextMonthStart)
    .first<{ total: number }>()
  const fixedCostTotalRow = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM fixed_costs WHERE household_id = ? AND include_in_household_total = 1',
  )
    .bind(householdId)
    .first<{ total: number }>()

  // 今日の収支は世帯合計ではなく、本人が登録した収入−支出をJST日付で集計する。
  const today = formatJstToday()
  const [todayIncomeRow, todayExpenseRow] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM incomes WHERE household_id = ? AND earner_user_id = ? AND income_date = ?',
    )
      .bind(householdId, c.get('userId'), today)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE household_id = ? AND payer_user_id = ? AND expense_date = ?',
    )
      .bind(householdId, c.get('userId'), today)
      .first<{ total: number }>(),
  ])

  // 献立は世帯共有の情報のため、当週の全エントリをレシピ名と自由メモの形で返す。
  const weeklyMenuEntries = await db
    .select({ recipeTitle: recipes.title, freeTextMemo: menuEntries.freeTextMemo })
    .from(menuEntries)
    .leftJoin(recipes, eq(menuEntries.recipeId, recipes.id))
    .where(and(eq(menuEntries.householdId, householdId), eq(menuEntries.weekStartDate, currentWeekStart(jstToday))))
    .orderBy(menuEntries.id)
    .all()

  // 世帯共有または本人所有のイベントだけを取得し、繰り返し規則から今日の発生分を判定する。
  const visibleEvents = await db
    .select({ id: events.id, name: events.name, eventDate: events.eventDate, recurrenceType: events.recurrenceType, showOnDashboard: events.showOnDashboard })
    .from(events)
    .where(and(eq(events.householdId, householdId), or(isNull(events.ownerUserId), eq(events.ownerUserId, c.get('userId')))))
    .orderBy(events.id)
    .all()
  const todayEvents = visibleEvents
    .filter((event) => resolveOccurrences({ ...event, recurrenceType: event.recurrenceType as RecurrenceType }, today, today).length > 0)
    .map((event) => ({ name: event.name, recurrenceType: event.recurrenceType }))

  const eventRange =
    eventPeriod === 'month'
      ? { rangeStart: monthStart, rangeEnd: nextMonthStart }
      : { rangeStart: `${jstToday.getUTCFullYear()}-01-01`, rangeEnd: `${jstToday.getUTCFullYear() + 1}-01-01` }
  const [monthlyPersonalExpenseRow, receivableRow, payableRow, eventExpenseRows] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE household_id = ? AND payer_user_id = ? AND expense_date >= ? AND expense_date < ?',
    )
      .bind(householdId, c.get('userId'), monthStart, nextMonthStart)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(s.amount_due), 0) AS total FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND e.payer_user_id = ? AND s.status != 'settled'",
    )
      .bind(householdId, c.get('userId'))
      .first<{ count: number; total: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(s.amount_due), 0) AS total FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND s.debtor_user_id = ? AND s.status != 'settled'",
    )
      .bind(householdId, c.get('userId'))
      .first<{ count: number; total: number }>(),
    c.env.DB.prepare(
      'SELECT event_id AS eventId, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE household_id = ? AND payer_user_id = ? AND event_id IS NOT NULL AND expense_date >= ? AND expense_date < ? GROUP BY event_id',
    )
      .bind(householdId, c.get('userId'), eventRange.rangeStart, eventRange.rangeEnd)
      .all<{ eventId: number; total: number }>(),
  ])
  const eventTotals = new Map(eventExpenseRows.results.map((row) => [row.eventId, row.total]))
  const eventExpenseSummaries = visibleEvents
    .filter((event) => event.showOnDashboard)
    .map((event) => ({ eventId: event.id, name: event.name, total: eventTotals.get(event.id) ?? 0 }))

  return c.json({
    shoppingListCount: shoppingListCountRow?.count ?? 0,
    lowStockCount: lowStockCountRow?.count ?? 0,
    householdExpenseTotal: (expenseTotalRow?.total ?? 0) + (fixedCostTotalRow?.total ?? 0),
    todayBalance: (todayIncomeRow?.total ?? 0) - (todayExpenseRow?.total ?? 0),
    weeklyMenuEntries,
    todayEvents,
    monthlyPersonalExpense: monthlyPersonalExpenseRow?.total ?? 0,
    unsettledReceivable: { count: receivableRow?.count ?? 0, total: receivableRow?.total ?? 0 },
    unsettledPayable: { count: payableRow?.count ?? 0, total: payableRow?.total ?? 0 },
    eventExpenseSummaries,
  })
})

dashboardRoute.get('/calendar', async (c) => {
  const month = c.req.query('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !isValidCalendarDate(`${month}-01`)) {
    return c.json(errorResponse('VALIDATION_ERROR', 'monthは実在するYYYY-MM形式で指定してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const monthStart = `${month}-01`
  const nextMonthStart = `${year + (monthNumber === 12 ? 1 : 0)}-${(monthNumber === 12 ? 1 : monthNumber + 1).toString().padStart(2, '0')}-01`
  const days = Array.from({ length: lastDay }, (_, index) => ({
    date: `${month}-${(index + 1).toString().padStart(2, '0')}`,
    fixedCosts: [] as string[],
    events: [] as { name: string; isRecurring: boolean }[],
    balance: 0,
  }))
  const daysByDate = new Map(days.map((day) => [day.date, day]))

  const [incomeRows, expenseRows, visibleFixedCosts, visibleEvents] = await Promise.all([
    c.env.DB.prepare(
      `SELECT income_date AS date, COALESCE(SUM(amount), 0) AS total FROM incomes
       WHERE household_id = ? AND earner_user_id = ? AND income_date >= ? AND income_date < ? GROUP BY income_date`,
    )
      .bind(householdId, userId, monthStart, nextMonthStart)
      .all<{ date: string; total: number }>(),
    c.env.DB.prepare(
      `SELECT expense_date AS date, COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE household_id = ? AND payer_user_id = ? AND expense_date >= ? AND expense_date < ? GROUP BY expense_date`,
    )
      .bind(householdId, userId, monthStart, nextMonthStart)
      .all<{ date: string; total: number }>(),
    db
      .select({ name: fixedCosts.name, paymentDay: fixedCosts.paymentDay })
      .from(fixedCosts)
      .where(and(eq(fixedCosts.householdId, householdId), or(isNull(fixedCosts.ownerUserId), eq(fixedCosts.ownerUserId, userId))))
      .orderBy(fixedCosts.id)
      .all(),
    db
      .select({ name: events.name, eventDate: events.eventDate, recurrenceType: events.recurrenceType, notifyEnabled: events.notifyEnabled })
      .from(events)
      .where(and(eq(events.householdId, householdId), or(isNull(events.ownerUserId), eq(events.ownerUserId, userId))))
      .orderBy(events.id)
      .all(),
  ])

  for (const row of incomeRows.results) {
    const day = daysByDate.get(row.date)
    if (day) day.balance += row.total
  }
  for (const row of expenseRows.results) {
    const day = daysByDate.get(row.date)
    if (day) day.balance -= row.total
  }
  for (const fixedCost of visibleFixedCosts) {
    const date = `${month}-${Math.min(fixedCost.paymentDay, lastDay).toString().padStart(2, '0')}`
    daysByDate.get(date)?.fixedCosts.push(fixedCost.name)
  }
  for (const event of visibleEvents) {
    const recurrenceType = event.recurrenceType as RecurrenceType
    for (const date of resolveOccurrences({ eventDate: event.eventDate, recurrenceType }, monthStart, `${month}-${lastDay}`)) {
      daysByDate.get(date)?.events.push({ name: event.name, isRecurring: recurrenceType !== 'none' })
    }
  }

  const today = formatJstToday()
  const notificationCount = visibleEvents.filter(
    (event) =>
      event.notifyEnabled &&
      resolveOccurrences({ eventDate: event.eventDate, recurrenceType: event.recurrenceType as RecurrenceType }, today, today).length > 0,
  ).length

  return c.json({ days, notificationCount })
})
