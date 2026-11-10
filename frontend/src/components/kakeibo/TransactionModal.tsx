import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { apiClient } from '../../api/client'
import { useDialog } from '../../hooks/useDialog'
import { availableTransactionAccount, readLastTransactionAccount, writeLastTransactionAccount } from '../../lib/lastTransactionAccount'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Event } from '../../api/eventTypes'
import type { Account, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'
import { SplitFields, type HouseholdMember, type InitialSplit, type SplitFieldsResult } from './SplitFields'
import type { TransactionSelection } from './TransactionDetailModal'

type Kind = 'expense' | 'income'

interface Props {
  userId?: number | null
  identityLoading?: boolean
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
  // 関連する設定(カテゴリー管理・固定費)へ、画面の再読み込みなしで移動する処理。渡さないときは通常のリンクとして動く。
  onNavigate?: (path: string) => void
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

export function TransactionModal(props: Props) {
  // 利用者が変わると旧利用者の未保存draftも破棄する。
  return <TransactionForm key={props.userId ?? 'unknown'} {...props} />
}

function TransactionForm({
  userId = null,
  identityLoading = false,
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
  onNavigate,
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
  const [accountSelection, setAccountSelection] = useState(expense?.cardId != null ? `card:${expense.cardId}` : expense?.accountId != null ? `account:${expense.accountId}` : income?.accountId != null ? String(income.accountId) : !editing && accountsStatus === 'ok' ? availableTransactionAccount(initialKind, readLastTransactionAccount(userId, initialKind), accounts) : '')
  const accountChanged = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (editing || accountsStatus !== 'ok') return
    setAccountSelection(current => availableTransactionAccount(kind, accountChanged.current ? current : readLastTransactionAccount(userId, kind), accounts))
  }, [accounts, accountsStatus, editing, kind, userId])
  const handleAccountChange = (value: string) => {
    accountChanged.current = true
    setAccountSelection(value)
  }
  const [eventSelection, setEventSelection] = useState(expense?.eventId != null ? String(expense.eventId) : '')
  const [memo, setMemo] = useState(editing?.data.memo ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [splitSettingsOpen, setSplitSettingsOpen] = useState((initialSplits?.length ?? 0) > 0 || Boolean(expense?.includeInHouseholdTotal || expense?.eventId || editing?.data.memo))
  // 開いたら日付欄へフォーカスし、Tab移動をモーダル内に閉じ込める。Escapeで閉じるが、保存中は閉じない
  // (キャンセルボタンと同じ。保存完了前に古いデータで再操作・二重登録させないため)。
  const dialogRef = useDialog(() => { if (!submitting) onClose() }, '#tx-date')

  const categories = kind === 'expense' ? expenseCategories : incomeCategories
  // 関連する設定への移動(#487)。入力途中の内容は保存しない。保存の送信中は移動しない。
  const goTo = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (submitting) { event.preventDefault(); return }
    // 新しいタブで開く操作(Ctrl+クリックなど)はブラウザに任せる。
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate(path)
  }
  const incomeAccountUnavailable = accountsStatus !== 'ok' || (accounts.length === 0 && income?.accountId == null)

  const handleKindChange = (nextKind: Kind) => {
    setKind(nextKind)
    setCategoryId(firstCategoryId(nextKind === 'expense' ? expenseCategories : incomeCategories))
    accountChanged.current = false
    setAccountSelection(accountsStatus === 'ok' ? availableTransactionAccount(nextKind, readLastTransactionAccount(userId, nextKind), accounts) : '')
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
    if (submitting || identityLoading) return
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
      setSplitSettingsOpen(true)
      setError('メモは255文字以内で入力してください')
      return
    }
    // 割り勘の入力エラーは API 呼び出し前にブロックする。
    if (kind === 'expense' && splitResult.enabled && !splitResult.valid) {
      setSplitSettingsOpen(true)
      setError(splitResult.errorMessage || '割り勘の入力内容を確認してください')
      return
    }
    const shouldRememberAccount = Boolean(editing) || accountsStatus === 'ok' || accountChanged.current || accountSelection !== ''
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
      if (!active.current) return
      setError(getApiErrorMessage(err, `${kind === 'expense' ? '支出' : '収入'}の${editing ? '更新' : '登録'}に失敗しました`))
      setSubmitting(false)
      return
    }

    if (!active.current) return
    if (shouldRememberAccount) writeLastTransactionAccount(userId, kind, accountSelection)
    try {
      await onSaved(kind)
    } catch (err) {
      if (active.current) setError(getApiErrorMessage(err, '一覧の更新に失敗しました'))
    }
  }

  return (
    <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <div ref={dialogRef} className="modal event-modal transaction-modal" data-testid="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title">
        <h2 id="transaction-modal-title">{editing ? `${kind === 'expense' ? '支出' : '収入'}を編集` : '収支を登録'}</h2>
        {!editing && <div className="tabs transaction-kind-tabs" role="tablist">
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
          <div className="transaction-pair">
            <div>
              <label htmlFor="tx-date">日時</label>
              <input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="tx-amount">金額</label>
              <input
                id="tx-amount"
                type="number"
                step="1"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
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
          <div className="transaction-label-row">
            <label htmlFor="tx-category">カテゴリー</label>
            <a href="/categories" className="transaction-inline-link" onClick={goTo('/categories')}>カテゴリー管理<span aria-hidden="true">›</span></a>
          </div>
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
              <select id="tx-income-account" value={accountSelection} onChange={(e) => handleAccountChange(e.target.value)} disabled={incomeAccountUnavailable} required>
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
                onChange={(e) => handleAccountChange(e.target.value)}
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
            </>
          )}
          <button type="button" className="btn btn-secondary transaction-split-toggle" aria-expanded={splitSettingsOpen} aria-controls="transaction-split-settings" onClick={() => setSplitSettingsOpen(open => !open)}>
            <span>その他の設定</span>
            <span className="transaction-split-sub" aria-hidden="true">{kind === 'expense' ? '世帯合計・イベント・割り勘・メモ' : 'メモ'}</span>
          </button>
          <div id="transaction-split-settings" role="region" aria-label="その他の設定" hidden={!splitSettingsOpen}>
            {kind === 'expense' && <>
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
            </>}
          <label htmlFor="tx-memo">メモ</label>
          <textarea id="tx-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          {kind === 'expense' && !editing && <p className="transaction-fixed-hint">毎月の支払いは<a href="/fixed-costs" className="transaction-inline-link" onClick={goTo('/fixed-costs')}>固定費で登録<span aria-hidden="true">›</span></a></p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions ui-form-actions">
            <button type="button" className="ui-form-cancel" disabled={submitting} onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="ui-action" disabled={submitting || identityLoading || categories.length === 0 || (kind === 'income' && incomeAccountUnavailable)}>
              {editing ? '保存' : '登録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
