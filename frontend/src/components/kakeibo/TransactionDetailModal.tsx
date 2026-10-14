import { useEffect, useRef } from 'react'
import type { Account, Expense, Income, IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'
import type { ExpenseSplit, SplitStatus } from '../../api/warikanTypes'

export type TransactionSelection = { kind: 'expense'; data: Expense } | { kind: 'income'; data: Income }
const statusLabels: Record<SplitStatus, string> = { unpaid: '未請求', requested: '請求中', payment_reported: '受領確認待ち', pending: '保留中', settled: '精算済み' }

export function TransactionDetailModal({ transaction, accounts, expenseCategories, incomeCategories, events, splits, splitStatus, onClose }: {
  transaction: TransactionSelection
  accounts: Account[]
  expenseCategories: KakeiboCategory[]
  incomeCategories: IncomeCategory[]
  events: { id: number; name: string }[]
  splits: ExpenseSplit[]
  splitStatus: 'loading' | 'error' | 'ok'
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const expense = transaction.kind === 'expense' ? transaction.data : null
  const data = transaction.data
  const title = expense ? '支出詳細' : '収入詳細'
  const account = data.accountId === null ? 'なし' : accounts.find((item) => item.id === data.accountId)?.name ?? '取得できません'
  const card = expense?.cardId == null ? 'なし' : accounts.flatMap((item) => item.cards).find((item) => item.id === expense.cardId)?.name ?? '取得できません'
  const category = (expense ? expenseCategories : incomeCategories).find((item) => item.id === data.categoryId)?.name ?? '取得できません'
  const ownSplits = expense ? splits.filter((split) => split.expenseId === expense.id && split.role === 'payer') : []
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal event-modal transaction-detail-modal">
        <h2>{title}</h2>
        <dl className="event-detail-list">
          <dt>日付</dt><dd>{transaction.kind === 'expense' ? transaction.data.expenseDate : transaction.data.incomeDate}</dd>
          <dt>内容</dt><dd>{(transaction.kind === 'expense' ? transaction.data.purpose : transaction.data.content) || '内容なし'}</dd>
          <dt>金額</dt><dd className={expense ? 'calendar-expense' : 'calendar-income'}>{expense ? '-' : '+'}{data.amount.toLocaleString('ja-JP')}円</dd>
          <dt>種別</dt><dd>{expense ? '支出' : '収入'}</dd>
          <dt>カテゴリー</dt><dd>{category}</dd>
          <dt>{expense && expense.accountId === null && expense.cardId !== null ? 'チャージ型カード' : '口座'}</dt><dd>{expense && expense.accountId === null ? card : account}</dd>
          {expense && <>
            <dt>世帯合計対象</dt><dd>{expense.includeInHouseholdTotal ? '対象' : '対象外'}</dd>
            <dt>イベント</dt><dd>{expense.eventId === null ? 'なし' : events.find((item) => item.id === expense.eventId)?.name ?? '取得できません'}</dd>
          </>}
          <dt>メモ</dt><dd className="transaction-detail-memo">{data.memo || 'なし'}</dd>
          {expense && <><dt>割り勘内訳</dt><dd aria-live="polite">
            {splitStatus === 'loading' ? '読み込み中...' : splitStatus === 'error' ? <span role="alert">割り勘の取得に失敗しました</span> : ownSplits.length === 0 ? '割り勘内訳なし' : <ul className="transaction-split-list">{ownSplits.map((split) => <li key={split.id}>
              <span>{split.debtorLabel}{split.isExternal ? '（世帯外）' : ''}</span><br />
              <span>{split.splitInputType === 'ratio' ? `${split.splitRatio}% / ` : ''}{split.amountDue.toLocaleString('ja-JP')}円</span><br />
              <span>{statusLabels[split.status]}</span>
            </li>)}</ul>}
          </dd></>}
        </dl>
        <div className="modal-actions"><button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  )
}
