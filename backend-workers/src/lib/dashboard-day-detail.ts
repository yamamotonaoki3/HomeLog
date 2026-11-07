import { currentWeekStart } from './date'
import { resolveOccurrences, type RecurrenceType } from './event-recurrence'
import { fixedCostDisplayStatus, fixedCostPaymentDate, type FixedCostPostingStatus, type PostedFixedCostExpense } from './fixed-cost-display-status'

export interface DashboardDayDetail {
  date: string
  weekStartDate: string
  menuEntries: { id: number; recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null; weekStartDate: string }[]
  events: { id: number; name: string; isRecurring: boolean; recurrenceType: RecurrenceType; eventDate: string }[]
  finance: {
    income: number; expense: number; balance: number
    incomes: { id: number; incomeDate: string; amount: number; content: string }[]
    expenses: { id: number; expenseDate: string; amount: number; purpose: string; fixedCostId: number | null; fixedCostYearMonth: string | null }[]
  }
  fixedCosts: {
    id: number; name: string; amount: number; paymentDate: string; yearMonth: string
    postingStatus: FixedCostPostingStatus; postedExpense: PostedFixedCostExpense | null
  }[]
}
interface EventRow { id: number; name: string; eventDate: string; recurrenceType: RecurrenceType }
interface FixedCostRow {
  id: number; name: string; amount: number; paymentDay: number; createdByUserId: number
  createdAt: string; effectiveFrom: string | null
  postedId: number | null; postedDate: string | null; postedAmount: number | null; suppressed: number
}

/** 認証・所属確認後の集約。固定本数のSELECTだけで現在の可視情報を取得する。 */
export async function dashboardDayDetail(db: D1Database, householdId: number, userId: number, date: string, today: string): Promise<DashboardDayDetail> {
  const [year, month, day] = date.split('-').map(Number)
  const yearMonth = date.slice(0, 7)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const weekStartDate = currentWeekStart(new Date(Date.UTC(year, month - 1, day)))
  const [incomeResult, expenseResult, menuResult, eventResult, fixedCostResult] = await db.batch([
    db.prepare(
      'SELECT id, income_date AS incomeDate, amount, content FROM incomes WHERE household_id = ? AND earner_user_id = ? AND income_date = ? ORDER BY id DESC',
    ).bind(householdId, userId, date),
    db.prepare(
      `SELECT e.id, e.expense_date AS expenseDate, e.amount, e.purpose,
         f.id AS fixedCostId, CASE WHEN f.id IS NOT NULL THEN e.fixed_cost_year_month ELSE NULL END AS fixedCostYearMonth
       FROM expenses e
       LEFT JOIN fixed_costs f ON f.id = e.fixed_cost_id AND f.household_id = ? AND (f.owner_user_id IS NULL OR f.owner_user_id = ?)
       WHERE e.household_id = ? AND e.payer_user_id = ? AND e.expense_date = ? ORDER BY e.id DESC`,
    ).bind(householdId, userId, householdId, userId, date),
    db.prepare(
      `SELECT m.id, m.recipe_id AS recipeId, r.title AS recipeTitle, m.free_text_memo AS freeTextMemo, m.week_start_date AS weekStartDate
       FROM menu_entries m LEFT JOIN recipes r ON r.id = m.recipe_id AND r.household_id = ?
       WHERE m.household_id = ? AND m.week_start_date = ? ORDER BY m.id`,
    ).bind(householdId, householdId, weekStartDate),
    db.prepare(
      'SELECT id, name, event_date AS eventDate, recurrence_type AS recurrenceType FROM events WHERE household_id = ? AND (owner_user_id IS NULL OR owner_user_id = ?) ORDER BY id',
    ).bind(householdId, userId),
    db.prepare(
      `SELECT f.id, f.name, f.amount, f.payment_day AS paymentDay, f.created_by_user_id AS createdByUserId,
         f.created_at AS createdAt, f.effective_from AS effectiveFrom,
         e.id AS postedId, e.expense_date AS postedDate, e.amount AS postedAmount,
         CASE WHEN s.fixed_cost_id IS NOT NULL THEN 1 ELSE 0 END AS suppressed
       FROM fixed_costs f
       LEFT JOIN expenses e ON f.created_by_user_id = ? AND e.fixed_cost_id = f.id AND e.fixed_cost_year_month = ?
         AND e.household_id = ? AND e.payer_user_id = ?
       LEFT JOIN fixed_cost_posting_suppressions s ON f.created_by_user_id = ? AND s.fixed_cost_id = f.id AND s.year_month = ?
       WHERE f.household_id = ? AND (f.owner_user_id IS NULL OR f.owner_user_id = ?) AND MIN(f.payment_day, ?) = ?
       ORDER BY f.id`,
    ).bind(userId, yearMonth, householdId, userId, userId, yearMonth, householdId, userId, lastDay, day),
  ])
  const incomes = incomeResult.results as DashboardDayDetail['finance']['incomes']
  const expenses = expenseResult.results as DashboardDayDetail['finance']['expenses']
  const income = incomes.reduce((total, row) => total + row.amount, 0)
  const expense = expenses.reduce((total, row) => total + row.amount, 0)
  const events = (eventResult.results as unknown as EventRow[])
    .filter((event) => resolveOccurrences(event, date, date).length > 0)
    .map((event) => ({ ...event, isRecurring: event.recurrenceType !== 'none' }))
  const fixedCosts = (fixedCostResult.results as unknown as FixedCostRow[]).map((row) => {
    const own = row.createdByUserId === userId
    const postedExpense = own && row.postedId !== null && row.postedDate !== null && row.postedAmount !== null
      ? { id: row.postedId, expenseDate: row.postedDate, amount: row.postedAmount }
      : null
    if (postedExpense && row.suppressed) console.warn('Fixed cost has both posting and suppression records.')
    const paymentDate = fixedCostPaymentDate(yearMonth, row.paymentDay)
    return {
      id: row.id, name: row.name, amount: row.amount, paymentDate, yearMonth,
      postingStatus: fixedCostDisplayStatus({ createdByUserId: row.createdByUserId, userId, paymentDate, today,
        createdAt: row.createdAt, effectiveFrom: row.effectiveFrom, postedExpense, suppressed: Boolean(row.suppressed) }),
      postedExpense,
    }
  })
  return { date, weekStartDate, menuEntries: menuResult.results as DashboardDayDetail['menuEntries'], events,
    finance: { income, expense, balance: income - expense, incomes, expenses }, fixedCosts }
}
