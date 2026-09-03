import { useState } from 'react'
import type { Account } from '../../api/kakeiboTypes'

interface Props {
  title: string
  description: string
  submitLabel: string
  accounts: Account[]
  submitting: boolean
  onSubmit: (accountId: number | null) => void
  onClose: () => void
}

/**
 * 割り勘の精算(支払う / 受け取りました / 精算済みにする)で、口座を任意選択するための小さなモーダル。
 * 「口座を選択しない」場合は家計簿の収支だけを記録し、口座残高は動かさない。
 */
export function SettlementAccountModal({ title, description, submitLabel, accounts, submitting, onSubmit, onClose }: Props) {
  const [selection, setSelection] = useState('')

  return (
    <div className="modal-overlay">
      <div className="modal" data-testid="settlement-account-modal">
        <h2>{title}</h2>
        <p className="hint">{description}</p>
        <label htmlFor="settlement-account">口座（任意）</label>
        <select id="settlement-account" value={selection} onChange={(e) => setSelection(e.target.value)}>
          <option value="">口座を選択しない</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting}
            onClick={() => onSubmit(selection === '' ? null : Number(selection))}
          >
            {submitLabel}
          </button>
          <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
