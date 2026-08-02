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
}
