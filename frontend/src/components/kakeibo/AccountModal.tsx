import { useState, type FormEvent } from 'react'
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
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
    } catch (err) {
      setError(getApiErrorMessage(err, '口座一覧の更新に失敗しました'))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
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
