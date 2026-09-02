import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Event } from '../../api/eventTypes'
import type { Account, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'
import { SplitFields, type HouseholdMember, type SplitFieldsResult } from './SplitFields'

type Kind = 'expense' | 'income'

interface Props {
  expenseCategories: KakeiboCategory[]
  incomeCategories: IncomeCategory[]
  accounts: Account[]
  // イベント紐付けは支出のみが対象(F06ドキュメント「支出とイベントの紐付け」)。
  events: Event[]
  // 割り勘の相手候補(自分以外の世帯メンバー)。
  members: HouseholdMember[]
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

export function TransactionModal({
  expenseCategories,
  incomeCategories,
  accounts,
  events,
  members,
  initialKind,
  onClose,
  onSaved,
}: Props) {
  const [kind, setKind] = useState<Kind>(initialKind)
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [splitResult, setSplitResult] = useState<SplitFieldsResult>({
    enabled: false,
    valid: true,
    splitInputType: 'ratio',
    splits: [],
    errorMessage: '',
  })
  const handleSplitChange = useCallback((result: SplitFieldsResult) => setSplitResult(result), [])
  const [purpose, setPurpose] = useState('')
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState<string>(
    firstCategoryId(initialKind === 'expense' ? expenseCategories : incomeCategories),
  )
  const [includeInHouseholdTotal, setIncludeInHouseholdTotal] = useState(false)
  const [accountSelection, setAccountSelection] = useState('')
  const [eventSelection, setEventSelection] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const categories = kind === 'expense' ? expenseCategories : incomeCategories

  const handleKindChange = (nextKind: Kind) => {
    setKind(nextKind)
    setCategoryId(firstCategoryId(nextKind === 'expense' ? expenseCategories : incomeCategories))
    setAccountSelection('')
    setEventSelection('')
    setError('')
  }

  // イベントを選択すると、そのイベントのdefaultAmountが設定されていれば金額欄へ自動入力する
  // (ユーザーは登録前に上書き可能。F06ドキュメント「支出とイベントの紐付け」参照)。
  const handleEventSelectionChange = (value: string) => {
    setEventSelection(value)
    if (value === '') return
    const selectedEvent = events.find((event) => event.id === Number(value))
    if (selectedEvent?.defaultAmount != null) {
      setAmount(String(selectedEvent.defaultAmount))
    }
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
    // 割り勘の入力エラーは API 呼び出し前にブロックする。
    if (kind === 'expense' && splitResult.enabled && !splitResult.valid) {
      setError(splitResult.errorMessage || '割り勘の入力内容を確認してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      if (kind === 'expense') {
        const [selectionType, selectionId] = accountSelection === '' ? [null, null] : accountSelection.split(':')
        await apiClient.post('/expenses', {
          expenseDate: date,
          amount: amountValue,
          purpose: trimmedDescription,
          categoryId: Number(categoryId),
          memo: trimmedMemo === '' ? null : trimmedMemo,
          includeInHouseholdTotal,
          accountId: selectionType === 'account' ? Number(selectionId) : null,
          cardId: selectionType === 'card' ? Number(selectionId) : null,
          eventId: eventSelection === '' ? null : Number(eventSelection),
          ...(splitResult.enabled && splitResult.splits.length > 0
            ? { splitInputType: splitResult.splitInputType, splits: splitResult.splits }
            : {}),
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
            disabled={expenseCategories.length === 0}
          >
            支出
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'income'}
            className={kind === 'income' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => handleKindChange('income')}
            disabled={incomeCategories.length === 0}
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
            <>
              <label htmlFor="tx-account">口座/カード（任意）</label>
              <select
                id="tx-account"
                value={accountSelection}
                onChange={(e) => setAccountSelection(e.target.value)}
              >
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
              <label htmlFor="tx-household-total">
                <input
                  id="tx-household-total"
                  type="checkbox"
                  checked={includeInHouseholdTotal}
                  onChange={(e) => setIncludeInHouseholdTotal(e.target.checked)}
                />{' '}
                世帯合計に含める
              </label>
              <label htmlFor="tx-event">イベント（任意）</label>
              <select id="tx-event" value={eventSelection} onChange={(e) => handleEventSelectionChange(e.target.value)}>
                <option value="">選択しない</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              <SplitFields amount={Number(amount) || 0} members={members} onChange={handleSplitChange} />
            </>
          )}
          <label htmlFor="tx-memo">メモ</label>
          <textarea id="tx-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting || categories.length === 0}>
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
