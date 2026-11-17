import { useState, type FormEvent } from 'react'
import { useDialog } from '../../hooks/useDialog'
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
  const [cardType, setCardType] = useState('credit')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const close = () => { if (!submitting) onClose() }
  const ref = useDialog(close, '#card-account')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
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
        cardType,
      })
    } catch (err) {
      setError(getApiErrorMessage(err, 'カードの登録に失敗しました'))
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
    <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={ref} className="modal accounts-form-modal" role="dialog" aria-modal="true" aria-label="カードを登録">
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
          <label htmlFor="card-type">種別</label>
          <select id="card-type" value={cardType} onChange={(e) => setCardType(e.target.value)}>
            <option value="credit">クレジットカード</option>
            <option value="charge">チャージ型カード</option>
          </select>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting || accounts.length === 0}>
              登録
            </button>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
