import type { Expense, KakeiboCategory } from '../../api/kakeiboTypes'

interface Props {
  expenses: Expense[]
  categories: KakeiboCategory[]
  categoryFilter: string
  onCategoryFilterChange: (categoryId: string) => void
  onAddClick: () => void
}

export function ExpenseListPanel({
  expenses,
  categories,
  categoryFilter,
  onCategoryFilterChange,
  onAddClick,
}: Props) {
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''

  return (
    <div className="panel" data-testid="expense-panel">
      <div className="toolbar">
        <h2>家計簿</h2>
        <select
          aria-label="カテゴリー絞り込み"
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
        >
          <option value="">すべて</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={onAddClick}>
          支出を登録
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>日時</th>
            <th>使用用途</th>
            <th>カテゴリー</th>
            <th>金額</th>
            <th>世帯合算対象</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {expenses.length === 0 ? (
            <tr>
              <td colSpan={6}>支出はありません</td>
            </tr>
          ) : (
            expenses.map((expense) => (
              <tr key={expense.id}>
                <td>{expense.expenseDate}</td>
                <td>{expense.purpose}</td>
                <td>{categoryName(expense.categoryId)}</td>
                <td>{expense.amount}</td>
                <td>{expense.includeInHouseholdTotal ? '○' : ''}</td>
                <td>{expense.memo}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
