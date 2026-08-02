import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Account, Expense, Income, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'

type TypeFilter = 'all' | 'expense' | 'income'

interface TransactionRow {
  id: string
  kind: 'expense' | 'income'
  date: string
  description: string
  categoryName: string
  amount: number
  includeInHouseholdTotal: boolean | null
  accountName: string
  memo: string | null
}

interface Props {
  expenses: Expense[]
  incomes: Income[]
  expenseCategories: KakeiboCategory[]
  incomeCategories: IncomeCategory[]
  accounts: Account[]
  typeFilter: TypeFilter
  onTypeFilterChange: (value: TypeFilter) => void
  activeCategoryFilter: string
  activeCategoryOptions: KakeiboCategory[] | IncomeCategory[]
  onActiveCategoryFilterChange: (categoryId: string) => void
  onAddClick: () => void
  addDisabled: boolean
}

function emptyMessage(typeFilter: TypeFilter) {
  if (typeFilter === 'expense') return '支出はありません'
  if (typeFilter === 'income') return '収入はありません'
  return '収支の記録はありません'
}

export function TransactionListPanel({
  expenses,
  incomes,
  expenseCategories,
  incomeCategories,
  accounts,
  typeFilter,
  onTypeFilterChange,
  activeCategoryFilter,
  activeCategoryOptions,
  onActiveCategoryFilterChange,
  onAddClick,
  addDisabled,
}: Props) {
  const rows = useMemo<TransactionRow[]>(() => {
    const findExpenseCategoryName = (id: number) => expenseCategories.find((c) => c.id === id)?.name ?? ''
    const findIncomeCategoryName = (id: number) => incomeCategories.find((c) => c.id === id)?.name ?? ''
    const findAccountName = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? ''
    const findCardName = (id: number | null) =>
      accounts.flatMap((a) => a.cards).find((c) => c.id === id)?.name ?? ''

    const expenseRows: TransactionRow[] = expenses.map((expense) => ({
      id: `expense-${expense.id}`,
      kind: 'expense',
      date: expense.expenseDate,
      description: expense.purpose,
      categoryName: findExpenseCategoryName(expense.categoryId),
      amount: expense.amount,
      includeInHouseholdTotal: expense.includeInHouseholdTotal,
      accountName: expense.accountId !== null ? findAccountName(expense.accountId) : findCardName(expense.cardId),
      memo: expense.memo,
    }))
    const incomeRows: TransactionRow[] = incomes.map((income) => ({
      id: `income-${income.id}`,
      kind: 'income',
      date: income.incomeDate,
      description: income.content,
      categoryName: findIncomeCategoryName(income.categoryId),
      amount: income.amount,
      includeInHouseholdTotal: null,
      accountName: '',
      memo: income.memo,
    }))

    if (typeFilter === 'expense') return expenseRows
    if (typeFilter === 'income') return incomeRows
    return [...expenseRows, ...incomeRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [expenses, incomes, expenseCategories, incomeCategories, accounts, typeFilter])

  return (
    <div className="panel" data-testid="transaction-panel">
      <div className="toolbar">
        <h2>家計簿</h2>
        <select
          aria-label="種別絞り込み"
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value as TypeFilter)}
        >
          <option value="all">すべて</option>
          <option value="expense">支出</option>
          <option value="income">収入</option>
        </select>
        {typeFilter !== 'all' && (
          <select
            aria-label="カテゴリー絞り込み"
            value={activeCategoryFilter}
            onChange={(e) => onActiveCategoryFilterChange(e.target.value)}
          >
            <option value="">すべて</option>
            {activeCategoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-primary" onClick={onAddClick} disabled={addDisabled}>
          登録
        </button>
        <Link to="/fixed-costs" className="btn btn-secondary">
          固定費
        </Link>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>日時</th>
            <th>種別</th>
            <th>内容</th>
            <th>カテゴリー</th>
            <th>金額</th>
            <th>世帯合算対象</th>
            <th>口座</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8}>{emptyMessage(typeFilter)}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.kind === 'expense' ? '支出' : '収入'}</td>
                <td>{row.description}</td>
                <td>{row.categoryName}</td>
                <td>{row.amount}</td>
                <td>{row.includeInHouseholdTotal ? '○' : ''}</td>
                <td>{row.accountName}</td>
                <td>{row.memo}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
