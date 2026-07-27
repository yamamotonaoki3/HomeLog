import type { Income, IncomeCategory } from '../../api/kakeiboTypes'

interface Props {
  incomes: Income[]
  categories: IncomeCategory[]
  categoryFilter: string
  onCategoryFilterChange: (categoryId: string) => void
  onAddClick: () => void
  addDisabled: boolean
}

export function IncomeListPanel({
  incomes,
  categories,
  categoryFilter,
  onCategoryFilterChange,
  onAddClick,
  addDisabled,
}: Props) {
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''

  return (
    <div className="panel" data-testid="income-panel">
      <div className="toolbar">
        <h2>収入一覧</h2>
        <select
          aria-label="収入カテゴリー絞り込み"
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
        <button type="button" className="btn btn-primary" onClick={onAddClick} disabled={addDisabled}>
          収入を登録
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>日時</th>
            <th>収入内容</th>
            <th>カテゴリー</th>
            <th>金額</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {incomes.length === 0 ? (
            <tr>
              <td colSpan={5}>収入はありません</td>
            </tr>
          ) : (
            incomes.map((income) => (
              <tr key={income.id}>
                <td>{income.incomeDate}</td>
                <td>{income.content}</td>
                <td>{categoryName(income.categoryId)}</td>
                <td>{income.amount}</td>
                <td>{income.memo}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
