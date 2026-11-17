import { useState, type FormEvent } from 'react'
import { useDialog } from '../../hooks/useDialog'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'

interface Props {
  onClose: () => void
  onSaved: () => Promise<void>
}

export function AccountModal({ onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState('bank')
  const [balance, setBalance] = useState('0')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const close = () => { if (!submitting) onClose() }
  const ref = useDialog(close, '#acc-name')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('口座名は1〜50文字で入力してください')
      return
    }
    const balanceValue = Number(balance)
    if (!Number.isInteger(balanceValue) || balanceValue < -9_999_999_999 || balanceValue > 9_999_999_999) {
      setError('初期残高は整数で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/accounts', {
        name: trimmedName,
        type,
        balance: balanceValue,
      })
    } catch (err) {
      setError(getApiErrorMessage(err, '口座の登録に失敗しました'))
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
      <div ref={ref} className="modal accounts-form-modal" role="dialog" aria-modal="true" aria-label="口座を登録">
        <h2>口座を登録</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="acc-name">口座名</label>
          <input
            id="acc-name"
            type="text"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="acc-type">種別</label>
          <select id="acc-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="bank">銀行</option>
            <option value="e_money">電子マネー</option>
          </select>
          <label htmlFor="acc-balance">初期残高</label>
          <input
            id="acc-balance"
            type="number"
            step="1"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
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
