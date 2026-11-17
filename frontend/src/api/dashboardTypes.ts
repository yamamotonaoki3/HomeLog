export interface DashboardSummary {
  shoppingListCount: number
  lowStockCount: number
  householdExpenseTotal: number
  todayBalance: number
  weeklyMenuEntries: { recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null }[]
  todayEvents: { name: string; recurrenceType: string }[]
  monthlyPersonalExpense: number
  unsettledReceivable: { count: number; total: number }
  unsettledPayable: { count: number; total: number }
  eventExpenseSummaries: { eventId: number; name: string; total: number }[]
}

export type FixedCostPostingStatus = 'posted' | 'scheduled' | 'missing' | 'suppressed' | 'not_applicable' | 'unknown'
export interface DashboardDayDetail {
  date: string
  weekStartDate: string
  menuEntries: { id: number; recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null; weekStartDate: string }[]
  events: { id: number; name: string; isRecurring: boolean; recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'; eventDate: string }[]
  finance: {
    income: number; expense: number; balance: number
    incomes: { id: number; incomeDate: string; amount: number; content: string }[]
    expenses: { id: number; expenseDate: string; amount: number; purpose: string; fixedCostId: number | null; fixedCostYearMonth: string | null }[]
  }
  fixedCosts: {
    id: number; name: string; amount: number; paymentDate: string; yearMonth: string
    postingStatus: FixedCostPostingStatus
    postedExpense: { id: number; expenseDate: string; amount: number } | null
  }[]
}
