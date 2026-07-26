import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { KakeiboCategory } from '../../api/kakeiboTypes'

interface Props {
  categories: KakeiboCategory[]
  onClose: () => void
  onSaved: () => Promise<void>
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function ExpenseModal({ categories, onClose, onSaved }: Props) {
  const [expenseDate, setExpenseDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [categoryId, setCategoryId] = useState<string>(categories[0] ? String(categories[0].id) : '')
  const [includeInHouseholdTotal, setIncludeInHouseholdTotal] = useState(false)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedPurpose = purpose.trim()
    if (trimmedPurpose.length < 1 || trimmedPurpose.length > 100) {
      setError('使用用途は1〜100文字で入力してください')
      return
    }
    const amountValue = Number(amount)
    if (!Number.isInteger(amountValue) || amountValue < 1 || amountValue > 9_999_999_999) {
      setError('金額は1以上の整数で入力してください')
      return
    }
    const trimmedMemo = memo.trim()
    if (trimmedMemo.length > 255) {
      setError('メモは255文字以内で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/expenses', {
        expenseDate,
        amount: amountValue,
        purpose: trimmedPurpose,
        categoryId: Number(categoryId),
        memo: trimmedMemo === '' ? null : trimmedMemo,
        includeInHouseholdTotal,
      })
      await onSaved()
    } catch (err) {
      setError(getApiErrorMessage(err, '支出の登録に失敗しました'))
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>支出を登録</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="exp-date">日時</label>
          <input
            id="exp-date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
          <label htmlFor="exp-amount">金額</label>
          <input
            id="exp-amount"
            type="number"
            step="1"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label htmlFor="exp-purpose">使用用途</label>
          <input
            id="exp-purpose"
            type="text"
            maxLength={100}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <label htmlFor="exp-category">カテゴリー</label>
          <select id="exp-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="exp-household-total">
            <input
              id="exp-household-total"
              type="checkbox"
              checked={includeInHouseholdTotal}
              onChange={(e) => setIncludeInHouseholdTotal(e.target.checked)}
            />{' '}
            世帯合計に含める
          </label>
          <label htmlFor="exp-memo">メモ</label>
          <textarea id="exp-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              登録
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
