import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'

type Kind = 'expense' | 'income'

interface Props {
  kind: Kind
  category: KakeiboCategory | IncomeCategory | null
  onClose: () => void
  onSaved: () => Promise<void>
}

export function CategoryModal({ kind, category, onClose, onSaved }: Props) {
  const isEdit = category !== null
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const label = kind === 'expense' ? '支出カテゴリー' : '収入カテゴリー'
  const endpointBase = kind === 'expense' ? '/kakeibo-categories' : '/income-categories'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('カテゴリー名は1〜50文字で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      if (isEdit) {
        await apiClient.patch(`${endpointBase}/${category.id}`, { name: trimmedName })
      } else {
        await apiClient.post(endpointBase, { name: trimmedName })
      }
    } catch (err) {
      setError(getApiErrorMessage(err, isEdit ? `${label}の更新に失敗しました` : `${label}の登録に失敗しました`))
      setSubmitting(false)
      return
    }

    try {
      await onSaved()
    } catch {
      // The caller is responsible for notifying the user about refresh failures.
    } finally {
      onClose()
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{isEdit ? `${label}を編集` : `${label}を登録`}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="category-name">カテゴリー名</label>
          <input
            id="category-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {isEdit ? '更新' : '登録'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
