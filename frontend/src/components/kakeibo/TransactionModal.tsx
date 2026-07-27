import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'

type Kind = 'expense' | 'income'

interface Props {
  expenseCategories: KakeiboCategory[]
  incomeCategories: IncomeCategory[]
  initialKind: Kind
  onClose: () => void
  onSaved: (kind: Kind) => Promise<void>
}

function today() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function firstCategoryId(categories: KakeiboCategory[] | IncomeCategory[]) {
  return categories[0] ? String(categories[0].id) : ''
}

export function TransactionModal({ expenseCategories, incomeCategories, initialKind, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<Kind>(initialKind)
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState<string>(
    firstCategoryId(initialKind === 'expense' ? expenseCategories : incomeCategories),
  )
  const [includeInHouseholdTotal, setIncludeInHouseholdTotal] = useState(false)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const categories = kind === 'expense' ? expenseCategories : incomeCategories

  const handleKindChange = (nextKind: Kind) => {
    setKind(nextKind)
    setCategoryId(firstCategoryId(nextKind === 'expense' ? expenseCategories : incomeCategories))
    setError('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const descriptionLabel = kind === 'expense' ? '使用用途' : '収入内容'
    const trimmedDescription = (kind === 'expense' ? purpose : content).trim()
    if (trimmedDescription.length < 1 || trimmedDescription.length > 100) {
      setError(`${descriptionLabel}は1〜100文字で入力してください`)
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
      if (kind === 'expense') {
        await apiClient.post('/expenses', {
          expenseDate: date,
          amount: amountValue,
          purpose: trimmedDescription,
          categoryId: Number(categoryId),
          memo: trimmedMemo === '' ? null : trimmedMemo,
          includeInHouseholdTotal,
        })
      } else {
        await apiClient.post('/incomes', {
          incomeDate: date,
          amount: amountValue,
          content: trimmedDescription,
          categoryId: Number(categoryId),
          memo: trimmedMemo === '' ? null : trimmedMemo,
        })
      }
    } catch (err) {
      setError(getApiErrorMessage(err, kind === 'expense' ? '支出の登録に失敗しました' : '収入の登録に失敗しました'))
      setSubmitting(false)
      return
    }

    try {
      await onSaved(kind)
    } catch (err) {
      setError(getApiErrorMessage(err, '一覧の更新に失敗しました'))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" data-testid="transaction-modal">
        <h2>登録</h2>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'expense'}
            className={kind === 'expense' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => handleKindChange('expense')}
          >
            支出
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'income'}
            className={kind === 'income' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => handleKindChange('income')}
          >
            収入
          </button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="tx-date">日時</label>
          <input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label htmlFor="tx-amount">金額</label>
          <input
            id="tx-amount"
            type="number"
            step="1"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {kind === 'expense' ? (
            <>
              <label htmlFor="tx-purpose">使用用途</label>
              <input
                id="tx-purpose"
                type="text"
                maxLength={100}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="tx-content">収入内容</label>
              <input
                id="tx-content"
                type="text"
                maxLength={100}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </>
          )}
          <label htmlFor="tx-category">カテゴリー</label>
          <select id="tx-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {kind === 'expense' && (
            <label htmlFor="tx-household-total">
              <input
                id="tx-household-total"
                type="checkbox"
                checked={includeInHouseholdTotal}
                onChange={(e) => setIncludeInHouseholdTotal(e.target.checked)}
              />{' '}
              世帯合計に含める
            </label>
          )}
          <label htmlFor="tx-memo">メモ</label>
          <textarea id="tx-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
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
