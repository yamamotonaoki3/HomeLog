import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { currentMonthRange, getJstToday } from '../lib/date'
import { errorResponse } from '../lib/errors'
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
  const { monthStart, nextMonthStart } = currentMonthRange(getJstToday())
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

  return c.json({
    shoppingListCount: shoppingListCountRow?.count ?? 0,
    lowStockCount: lowStockCountRow?.count ?? 0,
    householdExpenseTotal: (expenseTotalRow?.total ?? 0) + (fixedCostTotalRow?.total ?? 0),
  })
})
