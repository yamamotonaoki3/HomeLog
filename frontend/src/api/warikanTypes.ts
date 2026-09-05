// F-04 割り勘・精算管理。

// 割り勘内訳の状態(F04_kakeibo_warikan.md 3章)。
// unpaid: 未請求 / requested: 請求中(立替者が請求) / payment_reported: 受領確認待ち(負担者が支払報告)
//   / pending: 保留中 / settled: 精算済み
export type SplitStatus = 'unpaid' | 'requested' | 'payment_reported' | 'pending' | 'settled'

// GET /api/expense-splits から返ってくる割り勘内訳1件分。
export interface ExpenseSplit {
  id: number
  expenseId: number
  expensePurpose: string
  expenseAmount: number
  expenseDate: string
  // 自分がこの内訳の「支払者(立て替えた側)」か「負担者(支払う側)」か。
  role: 'payer' | 'debtor'
  // 相手が世帯外の非アプリ利用者か(true なら承認フロー無しで支払者の自己申告のみ)。
  isExternal: boolean
  payerLabel: string
  debtorLabel: string
  splitInputType: 'ratio' | 'amount'
  splitRatio: number
  amountDue: number
  status: SplitStatus
  // 負担者が「支払う」で選んだ支払い元口座。負担者本人が見たときのみ返る(他人には null)。
  debtorAccountId: number | null
  requestedAt: string | null
  settledAt: string | null
  // この内訳のコメント件数(GET/POST /api/expense-splits/:id/comments)。
  commentCount: number
}

// GET/POST /api/expense-splits/:id/comments の1件分。
export interface ExpenseSplitComment {
  id: number
  authorUserId: number
  authorLabel: string
  authorRole: 'payer' | 'debtor'
  body: string
  createdAt: string
}

// POST /api/expenses に添えて送る割り勘の相手(支払者=自分は含めない)1人分。
export interface SplitInput {
  debtorUserId?: number
  debtorExternalName?: string
  ratio?: number
  amountDue?: number
}
