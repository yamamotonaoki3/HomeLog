import { useState, type FormEvent } from 'react'
import { useDialog } from '../../hooks/useDialog'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Account, Card } from '../../api/kakeiboTypes'

interface Props {
  card: Card
  accounts: Account[]
  onClose: () => void
  onSaved: () => Promise<void>
}

export function ChargeModal({ card, accounts, onClose, onSaved }: Props) {
  const [fromAccountId, setFromAccountId] = useState<string>(accounts[0] ? String(accounts[0].id) : '')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const close = () => { if (!submitting) onClose() }
  const ref = useDialog(close, '#charge-account')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const amountValue = Number(amount)
    if (!Number.isInteger(amountValue) || amountValue < 1 || amountValue > 9_999_999_999) {
      setError('チャージ金額は1以上の整数で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post(`/cards/${card.id}/charges`, {
        fromAccountId: Number(fromAccountId),
        amount: amountValue,
      })
    } catch (err) {
      setError(getApiErrorMessage(err, 'チャージに失敗しました'))
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
      <div ref={ref} className="modal accounts-form-modal" role="dialog" aria-modal="true" aria-label={card.name + 'にチャージ'}>
        <h2>{card.name}にチャージ</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="charge-account">チャージ元口座</label>
          <select
            id="charge-account"
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <label htmlFor="charge-amount">チャージ金額</label>
          <input
            id="charge-amount"
            type="number"
            step="1"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting || accounts.length === 0}>
              チャージする
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
