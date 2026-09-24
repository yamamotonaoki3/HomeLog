import { and, eq, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { events, menuEntries, recipes } from '../db/schema'
import { currentMonthRange, currentWeekStart, formatJstToday, getJstToday } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { resolveOccurrences, type RecurrenceType } from '../lib/event-recurrence'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

export const dashboardRoute = new Hono<AppEnv>()

dashboardRoute.use('*', requireAuth)

dashboardRoute.get('/summary', async (c) => {
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
    .select({ name: events.name, eventDate: events.eventDate, recurrenceType: events.recurrenceType })
    .from(events)
    .where(and(eq(events.householdId, householdId), or(isNull(events.ownerUserId), eq(events.ownerUserId, c.get('userId')))))
    .orderBy(events.id)
    .all()
  const todayEvents = visibleEvents
    .filter((event) => resolveOccurrences({ ...event, recurrenceType: event.recurrenceType as RecurrenceType }, today, today).length > 0)
    .map((event) => ({ name: event.name, recurrenceType: event.recurrenceType }))

  return c.json({
    shoppingListCount: shoppingListCountRow?.count ?? 0,
    lowStockCount: lowStockCountRow?.count ?? 0,
    householdExpenseTotal: (expenseTotalRow?.total ?? 0) + (fixedCostTotalRow?.total ?? 0),
    todayBalance: (todayIncomeRow?.total ?? 0) - (todayExpenseRow?.total ?? 0),
    weeklyMenuEntries,
    todayEvents,
  })
})
