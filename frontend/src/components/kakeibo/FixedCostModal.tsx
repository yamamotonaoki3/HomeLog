import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Account, FixedCost } from '../../api/kakeiboTypes'
import { SplitFields, type HouseholdMember, type InitialSplit, type SplitFieldsResult } from './SplitFields'

const PRESET_NAMES = ['家賃', '水道代', '電気代', 'ガス代', 'インターネット代', '携帯電話代', 'サブスクリプション']

interface Props {
  fixedCost: FixedCost | null
  accounts: Account[]
  // 割り勘の相手候補（自分以外の世帯メンバー）。
  members: HouseholdMember[]
  // 世帯メンバー取得が完了したか（退出済みメンバー判定の保留制御）。
  membersLoaded?: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}

function initialAccountSelection(fixedCost: FixedCost | null): string {
  if (!fixedCost) return ''
  if (fixedCost.accountId !== null) return `account:${fixedCost.accountId}`
  if (fixedCost.cardId !== null) return `card:${fixedCost.cardId}`
  return ''
}

function toInitialSplits(fixedCost: FixedCost | null): InitialSplit[] {
  if (!fixedCost || fixedCost.splits.length === 0) return []
  const byAmount = fixedCost.splitInputType === 'amount'
  return fixedCost.splits.map((s) => ({
    debtorUserId: s.debtorUserId,
    ratio: byAmount ? undefined : s.splitRatio,
    amountDue: byAmount ? s.amountDue : undefined,
  }))
}

export function FixedCostModal({ fixedCost, accounts, members, membersLoaded = true, onClose, onSaved }: Props) {
  const isEdit = fixedCost !== null
  const [name, setName] = useState(fixedCost?.name ?? '')
  const [amount, setAmount] = useState(fixedCost ? String(fixedCost.amount) : '')
  const [paymentDay, setPaymentDay] = useState(fixedCost ? String(fixedCost.paymentDay) : '1')
  const [personal, setPersonal] = useState(fixedCost?.personal ?? false)
  const [includeInHouseholdTotal, setIncludeInHouseholdTotal] = useState(
    fixedCost?.includeInHouseholdTotal ?? false,
  )
  const [accountSelection, setAccountSelection] = useState(initialAccountSelection(fixedCost))
  const [split, setSplit] = useState<SplitFieldsResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSplitChange = useCallback((result: SplitFieldsResult) => {
    setSplit(result)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('固定費名は1〜50文字で入力してください')
      return
    }
    const amountValue = Number(amount)
    if (!Number.isInteger(amountValue) || amountValue <= 0 || amountValue > 9_999_999_999) {
      setError('金額は1以上の整数で入力してください')
      return
    }
    const paymentDayValue = Number(paymentDay)
    if (!Number.isInteger(paymentDayValue) || paymentDayValue < 1 || paymentDayValue > 31) {
      setError('支払日は1〜31の整数で入力してください')
      return
    }
    if (split?.enabled && !split.valid) {
      setError(split.errorMessage || '割り勘の入力内容を確認してください')
      return
    }
    setError('')
    setSubmitting(true)
    const [selectionType, selectionId] = accountSelection === '' ? [null, null] : accountSelection.split(':')
    const payload = {
      name: trimmedName,
      amount: amountValue,
      paymentDay: paymentDayValue,
      personal,
      includeInHouseholdTotal,
      accountId: selectionType === 'account' ? Number(selectionId) : null,
      cardId: selectionType === 'card' ? Number(selectionId) : null,
      splitInputType: split?.enabled ? split.splitInputType : null,
      splits: split?.enabled ? split.splits : [],
    }
    try {
      if (isEdit) {
        await apiClient.patch(`/fixed-costs/${fixedCost.id}`, payload)
      } else {
        await apiClient.post('/fixed-costs', payload)
      }
    } catch (err) {
      setError(getApiErrorMessage(err, isEdit ? '固定費の更新に失敗しました' : '固定費の登録に失敗しました'))
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
        <h2>{isEdit ? '固定費を編集' : '固定費を登録'}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="fc-name">固定費名</label>
          <input
            id="fc-name"
            type="text"
            list="fixed-cost-name-options"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <datalist id="fixed-cost-name-options">
            {PRESET_NAMES.map((presetName) => (
              <option key={presetName} value={presetName} />
            ))}
          </datalist>
          <label htmlFor="fc-amount">金額</label>
          <input id="fc-amount" type="number" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label htmlFor="fc-payment-day">支払日</label>
          <input
            id="fc-payment-day"
            type="number"
            step="1"
            min="1"
            max="31"
            value={paymentDay}
            onChange={(e) => setPaymentDay(e.target.value)}
          />
          <label htmlFor="fc-account">引き落とし元（任意）</label>
          <select id="fc-account" value={accountSelection} onChange={(e) => setAccountSelection(e.target.value)}>
            <option value="">選択しない</option>
            {accounts.map((account) => (
              <Fragment key={account.id}>
                <option value={`account:${account.id}`}>{account.name}</option>
                {account.cards.map((card) => (
                  <option key={card.id} value={`card:${card.id}`}>
                    　└ {card.name}
                  </option>
                ))}
              </Fragment>
            ))}
          </select>
          <fieldset>
            <legend>公開範囲</legend>
            <label>
              <input type="radio" name="fc-personal" checked={!personal} onChange={() => setPersonal(false)} />
              世帯共有
            </label>
            <label>
              <input type="radio" name="fc-personal" checked={personal} onChange={() => setPersonal(true)} />
              個人
            </label>
          </fieldset>
          <label htmlFor="fc-include-household-total">
            <input
              id="fc-include-household-total"
              type="checkbox"
              checked={includeInHouseholdTotal}
              onChange={(e) => setIncludeInHouseholdTotal(e.target.checked)}
            />
            世帯合計に含める
          </label>
          <SplitFields
            amount={Number(amount) || 0}
            members={members}
            membersLoaded={membersLoaded}
            allowExternal={false}
            initialSplits={toInitialSplits(fixedCost)}
            initialSplitInputType={fixedCost?.splitInputType ?? undefined}
            onChange={handleSplitChange}
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
