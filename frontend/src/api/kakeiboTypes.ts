export interface KakeiboCategory {
  id: number
  name: string
  isDefault: boolean
}

export interface Expense {
  id: number
  expenseDate: string
  amount: number
  purpose: string
  categoryId: number
  memo: string | null
  includeInHouseholdTotal: boolean
  accountId: number | null
  cardId: number | null
  eventId: number | null
}

export interface IncomeCategory {
  id: number
  name: string
  isDefault: boolean
}

export interface Income {
  id: number
  incomeDate: string
  amount: number
  content: string
  categoryId: number
  memo: string | null
}

export interface Card {
  id: number
  name: string
  accountId: number
  cardType: 'credit' | 'charge'
  balance: number
}

export interface Account {
  id: number
  name: string
  type: string
  balance: number
  cards: Card[]
}

export interface FixedCost {
  id: number
  name: string
  amount: number
  paymentDay: number
  personal: boolean
  includeInHouseholdTotal: boolean
  editable: boolean
  accountId: number | null
  cardId: number | null
}

// GET /api/accounts/:id/transactions（S-15 口座の取引履歴、F11_kakeibo_account.md §4）。
export interface AccountTransaction {
  id: number
  type: 'expense' | 'income' | 'charge'
  date: string
  description: string
  category: string | null
  memo: string | null
  direction: 'in' | 'out'
  amount: number
  // その取引直後の口座残高（現在残高から変動順に遡って再構成した値）。
  balanceAfter: number
}

export interface AccountTransactionsResponse {
  currentBalance: number
  transactions: AccountTransaction[]
}
