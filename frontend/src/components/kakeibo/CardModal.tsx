import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Account } from '../../api/kakeiboTypes'

interface Props {
  accounts: Account[]
  onClose: () => void
  onSaved: () => Promise<void>
}

export function CardModal({ accounts, onClose, onSaved }: Props) {
  const [accountId, setAccountId] = useState<string>(accounts[0] ? String(accounts[0].id) : '')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('カード名は1〜50文字で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/cards', {
        accountId: Number(accountId),
        name: trimmedName,
      })
    } catch (err) {
      setError(getApiErrorMessage(err, 'カードの登録に失敗しました'))
      setSubmitting(false)
      return
    }

    try {
      await onSaved()
    } catch (err) {
      setError(getApiErrorMessage(err, '口座一覧の更新に失敗しました'))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>カードを登録</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="card-account">紐づける口座</label>
          <select id="card-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <label htmlFor="card-name">カード名</label>
          <input
            id="card-name"
            type="text"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting || accounts.length === 0}>
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
