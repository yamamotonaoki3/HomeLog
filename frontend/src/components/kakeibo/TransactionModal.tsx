import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { useDialog } from '../../hooks/useDialog'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Event } from '../../api/eventTypes'
import type { Account, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'
import { SplitFields, type HouseholdMember, type InitialSplit, type SplitFieldsResult } from './SplitFields'
import type { TransactionSelection } from './TransactionDetailModal'

type Kind = 'expense' | 'income'

interface Props {
  expenseCategories: KakeiboCategory[]
  incomeCategories: IncomeCategory[]
  accounts: Account[]
  accountsStatus?: 'loading' | 'error' | 'ok'
  // イベント紐付けは支出のみが対象(F06ドキュメント「支出とイベントの紐付け」)。
  events: Event[]
  // 割り勘の相手候補(自分以外の世帯メンバー)。
  members: HouseholdMember[]
  initialKind: Kind
  editing?: TransactionSelection
  initialSplits?: InitialSplit[]
  initialSplitInputType?: 'ratio' | 'amount'
  membersLoaded?: boolean
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
  accountsStatus = 'ok',
  events,
  members,
  initialKind,
  editing,
  initialSplits,
  initialSplitInputType,
  membersLoaded = true,
  onClose,
  onSaved,
}: Props) {
  const expense = editing?.kind === 'expense' ? editing.data : undefined
  const income = editing?.kind === 'income' ? editing.data : undefined
  const [kind, setKind] = useState<Kind>(editing?.kind ?? initialKind)
  const [date, setDate] = useState(expense?.expenseDate ?? income?.incomeDate ?? today())
  const [amount, setAmount] = useState(editing ? String(editing.data.amount) : '')
  const [splitResult, setSplitResult] = useState<SplitFieldsResult>({
    enabled: false,
    valid: true,
    splitInputType: 'ratio',
    splits: [],
    errorMessage: '',
  })
  const handleSplitChange = useCallback((result: SplitFieldsResult) => setSplitResult(result), [])
  const [purpose, setPurpose] = useState(expense?.purpose ?? '')
  const [content, setContent] = useState(income?.content ?? '')
  const [categoryId, setCategoryId] = useState<string>(
    editing ? String(editing.data.categoryId) : firstCategoryId(initialKind === 'expense' ? expenseCategories : incomeCategories),
  )
  const [includeInHouseholdTotal, setIncludeInHouseholdTotal] = useState(expense?.includeInHouseholdTotal ?? false)
  const [accountSelection, setAccountSelection] = useState(expense?.cardId != null ? `card:${expense.cardId}` : expense?.accountId != null ? `account:${expense.accountId}` : income?.accountId != null ? String(income.accountId) : '')
  const [eventSelection, setEventSelection] = useState(expense?.eventId != null ? String(expense.eventId) : '')
  const [memo, setMemo] = useState(editing?.data.memo ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 開いたら日付欄へフォーカスし、Tab移動をモーダル内に閉じ込める。Escapeで閉じるが、保存中は閉じない
  // (キャンセルボタンと同じ。保存完了前に古いデータで再操作・二重登録させないため)。
  const dialogRef = useDialog(() => { if (!submitting) onClose() }, '#tx-date')

  const categories = kind === 'expense' ? expenseCategories : incomeCategories
  const incomeAccountUnavailable = accountsStatus !== 'ok' || (accounts.length === 0 && income?.accountId == null)

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
    if (submitting) return
    if (kind === 'income' && (accountsStatus !== 'ok' || (!accounts.some((account) => String(account.id) === accountSelection) && !(income?.accountId != null && String(income.accountId) === accountSelection)))) {
      setError('入金先口座を選択してください')
      return
    }
    const descriptionLabel = kind === 'expense' ? '使用用途' : '収入内容'
    const trimmedDescription = (kind === 'expense' ? purpose : content).trim()
    // 支出の使用用途は任意(空欄可・0〜100文字)。収入内容は必須(1〜100文字)。
    if (kind === 'expense' ? trimmedDescription.length > 100 : trimmedDescription.length < 1 || trimmedDescription.length > 100) {
      setError(kind === 'expense' ? `${descriptionLabel}は100文字以内で入力してください` : `${descriptionLabel}は1〜100文字で入力してください`)
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
    const save = (path: string, body: object) => editing
      ? apiClient.put(`${path}/${editing.data.id}`, body)
      : apiClient.post(path, body)
    try {
      if (kind === 'expense') {
        const [selectionType, selectionId] = accountSelection === '' ? [null, null] : accountSelection.split(':')
        await save('/expenses', {
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
        await save('/incomes', {
          accountId: Number(accountSelection),
          incomeDate: date,
          amount: amountValue,
          content: trimmedDescription,
          categoryId: Number(categoryId),
          memo: trimmedMemo === '' ? null : trimmedMemo,
        })
      }
    } catch (err) {
      setError(getApiErrorMessage(err, `${kind === 'expense' ? '支出' : '収入'}の${editing ? '更新' : '登録'}に失敗しました`))
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
      <div ref={dialogRef} className="modal event-modal transaction-modal" data-testid="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title">
        <h2 id="transaction-modal-title">{editing ? `${kind === 'expense' ? '支出' : '収入'}を編集` : '登録'}</h2>
        {!editing && <div className="tabs" role="tablist">
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
        </div>}
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
              <label htmlFor="tx-purpose">使用用途（任意）</label>
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
          {kind === 'income' && (
            <>
              <label htmlFor="tx-income-account">入金先口座（必須）</label>
              <select id="tx-income-account" value={accountSelection} onChange={(e) => setAccountSelection(e.target.value)} disabled={incomeAccountUnavailable} required>
                <option value="">選択してください</option>
                {income?.accountId != null && !accounts.some((account) => account.id === income.accountId) && <option value={income.accountId}>{income.accountName ?? '削除済み口座'}</option>}
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              {accountsStatus === 'loading' ? <p>口座を読み込み中...</p> : accountsStatus === 'error' ? <p role="alert" className="error">口座の取得に失敗しました。画面を再読み込みしてください</p> : accounts.length === 0 ? <p>収入の登録には口座が必要です。<a href="/accounts">口座管理へ</a></p> : null}
            </>
          )}
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
              <SplitFields amount={Number(amount) || 0} members={members} membersLoaded={membersLoaded} initialSplits={initialSplits} initialSplitInputType={initialSplitInputType} onChange={handleSplitChange} />
            </>
          )}
          <label htmlFor="tx-memo">メモ</label>
          <textarea id="tx-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting || categories.length === 0 || (kind === 'income' && incomeAccountUnavailable)}>
              {editing ? '保存' : '登録'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
