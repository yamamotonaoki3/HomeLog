import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Expense, Income, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'

type TypeFilter = 'all' | 'expense' | 'income'

interface TransactionRow {
  id: number
  kind: 'expense' | 'income'
  date: string
  description: string
  amount: number
}

interface Props {
  expenses: Expense[]
  incomes: Income[]
  onSelectTransaction: (kind: 'expense' | 'income', id: number, trigger: HTMLButtonElement) => void
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
  onSelectTransaction,
  typeFilter,
  onTypeFilterChange,
  activeCategoryFilter,
  activeCategoryOptions,
  onActiveCategoryFilterChange,
  onAddClick,
  addDisabled,
}: Props) {
  const rows = useMemo<TransactionRow[]>(() => {
    const expenseRows: TransactionRow[] = expenses.map((expense) => ({
      id: expense.id,
      kind: 'expense',
      date: expense.expenseDate,
      description: expense.purpose,
      amount: expense.amount,
    }))
    const incomeRows: TransactionRow[] = incomes.map((income) => ({
      id: income.id,
      kind: 'income',
      date: income.incomeDate,
      description: income.content,
      amount: income.amount,
    }))

    const filtered = typeFilter === 'expense' ? expenseRows : typeFilter === 'income' ? incomeRows : [...expenseRows, ...incomeRows]
    return filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [expenses, incomes, typeFilter])

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
        <Link to="/categories" className="btn btn-secondary">
          カテゴリー管理
        </Link>
      </div>
      <table className="table transaction-table">
        <thead>
          <tr>
            <th>日付</th>
            <th>内容</th>
            <th>金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3}>{emptyMessage(typeFilter)}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`} onClick={(event) => {
                const trigger = event.currentTarget.querySelector('button')!
                onSelectTransaction(row.kind, row.id, trigger)
              }}>
                <td>{row.date}</td>
                <td><button type="button" className="event-name-button" onClick={(event) => {
                  event.stopPropagation()
                  onSelectTransaction(row.kind, row.id, event.currentTarget)
                }}>{row.description || '内容なし'}</button></td>
                <td className={row.kind === 'income' ? 'calendar-income' : 'calendar-expense'}>{row.kind === 'income' ? '+' : '-'}{row.amount.toLocaleString('ja-JP')}円</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
