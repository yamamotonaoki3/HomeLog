import { useMemo, type Ref } from 'react'
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
  addButtonRef?: Ref<HTMLButtonElement>
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
  addButtonRef,
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
        <button ref={addButtonRef} type="button" className="btn btn-primary" onClick={onAddClick} disabled={addDisabled}>
          登録
        </button>
        <Link to="/fixed-costs" className="btn btn-secondary">
          固定費
        </Link>
        <Link to="/categories" className="btn btn-secondary">
          カテゴリー管理
        </Link>
      </div>
      <div className="transaction-list">
        <div className="list-row-heading transaction-grid"><span>日付</span><span>内容</span><span>金額</span></div>
        {rows.length === 0 ? <p>{emptyMessage(typeFilter)}</p> : rows.map((row) => (
          <button key={`${row.kind}-${row.id}`} type="button" className="list-row-button transaction-grid"
            aria-label={`${row.kind === 'income' ? '収入' : '支出'}：${row.description || '内容なし'}の詳細`}
            onClick={(event) => onSelectTransaction(row.kind, row.id, event.currentTarget)}>
            <span>{row.date}</span>
            <span>{row.description || '内容なし'}</span>
            <span className={row.kind === 'income' ? 'calendar-income' : 'calendar-expense'}>{row.kind === 'income' ? '+' : '-'}{row.amount.toLocaleString('ja-JP')}円</span>
          </button>
        ))}
      </div>
    </div>
  )
}
