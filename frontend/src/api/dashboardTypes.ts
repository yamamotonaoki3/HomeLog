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
