import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { IncomeCategory } from '../../api/kakeiboTypes'

interface Props {
  categories: IncomeCategory[]
  onClose: () => void
  onSaved: () => Promise<void>
}

function today() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function IncomeModal({ categories, onClose, onSaved }: Props) {
  const [incomeDate, setIncomeDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState<string>(categories[0] ? String(categories[0].id) : '')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedContent = content.trim()
    if (trimmedContent.length < 1 || trimmedContent.length > 100) {
      setError('収入内容は1〜100文字で入力してください')
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
      await apiClient.post('/incomes', {
        incomeDate,
        amount: amountValue,
        content: trimmedContent,
        categoryId: Number(categoryId),
        memo: trimmedMemo === '' ? null : trimmedMemo,
      })
    } catch (err) {
      setError(getApiErrorMessage(err, '収入の登録に失敗しました'))
      setSubmitting(false)
      return
    }

    try {
      await onSaved()
    } catch (err) {
      setError(getApiErrorMessage(err, '収入一覧の更新に失敗しました'))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>収入を登録</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="inc-date">日時</label>
          <input
            id="inc-date"
            type="date"
            value={incomeDate}
            onChange={(e) => setIncomeDate(e.target.value)}
          />
          <label htmlFor="inc-amount">金額</label>
          <input
            id="inc-amount"
            type="number"
            step="1"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label htmlFor="inc-content">収入内容</label>
          <input
            id="inc-content"
            type="text"
            maxLength={100}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label htmlFor="inc-category">カテゴリー</label>
          <select id="inc-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="inc-memo">メモ</label>
          <textarea id="inc-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
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
