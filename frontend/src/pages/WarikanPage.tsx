import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account } from '../api/kakeiboTypes'
import type { ExpenseSplit, SplitStatus } from '../api/warikanTypes'
import { Toast } from '../components/Toast'
import { ExpenseSplitCommentsModal } from '../components/warikan/ExpenseSplitCommentsModal'
import { SettlementAccountModal } from '../components/warikan/SettlementAccountModal'
import { useDialog } from '../hooks/useDialog'

const STATUS_LABEL: Record<SplitStatus, string> = {
  unpaid: '未請求',
  requested: '請求中',
  payment_reported: '受領確認待ち',
  pending: '保留中',
  settled: '精算済み',
}

// 口座選択を挟む精算操作。
type SettlementKind = 'pay' | 'receive' | 'self'

const SETTLEMENT_MODAL: Record<SettlementKind, { title: string; description: string; submitLabel: string; path: string; success: string }> = {
  pay: {
    title: '支払う口座を選択',
    description: '相手に支払った金額を、どの口座から出したかを選べます（任意）。選ぶとその口座の残高が減り、家計簿に「割り勘精算」の支出として記録されます。',
    submitLabel: '支払った',
    path: 'mark-paid',
    success: '支払いを報告しました',
  },
  receive: {
    title: '受取口座を選択',
    description: '受け取った金額を、どの口座に入れたかを選べます（任意）。選ぶとその口座の残高が増え、家計簿に「割り勘精算」の収入として記録されます。負担者の家計簿にも支出が記録されます。',
    submitLabel: '受け取りを確定',
    path: 'confirm-receipt',
    success: '精算を確定しました',
  },
  self: {
    title: '受取口座を選択',
    description: '世帯外の相手との精算を自己申告で確定します。受け取った口座を選ぶと残高が増え、家計簿に「割り勘精算」の収入として記録されます。',
    submitLabel: '精算済みにする',
    path: 'settle-self',
    success: '精算済みにしました',
  },
}

function purposeText(split: ExpenseSplit) {
  return split.expensePurpose.trim() === '' ? '（用途なし）' : split.expensePurpose
}

function partnerText(split: ExpenseSplit) {
  return split.role === 'payer' ? `${split.debtorLabel} へ請求` : `${split.payerLabel} へ支払`
}

// 一覧の行を押すと開く詳細モーダル。用途・割合・状態の表示と、請求・精算などの操作をまとめる。
// 口座選択・削除確認・コメントのモーダルを重ねる間は hidden にして、フォーカス制御を譲る。
function WarikanDetailModal({ split, hidden, working, onClose, onPatch, onSettle, onDelete, onComments }: {
  split: ExpenseSplit
  hidden: boolean
  working: boolean
  onClose: () => void
  onPatch: (path: string, message: string) => void
  onSettle: (kind: SettlementKind, trigger: HTMLButtonElement) => void
  onDelete: (trigger: HTMLButtonElement) => void
  onComments: (trigger: HTMLButtonElement) => void
}) {
  const ref = useDialog(onClose, '[data-close]')
  const payer = split.role === 'payer'
  const open = split.status !== 'settled'
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="割り勘詳細" data-testid="warikan-detail-modal" hidden={hidden} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} className="modal event-modal warikan-detail-content">
        <div className="warikan-detail-header">
          <h2>割り勘詳細</h2>
          <div className="warikan-header-actions">
            {payer && (open || split.isExternal) && <button type="button" className="btn btn-danger" disabled={working} aria-label={purposeText(split) + 'の割り勘を削除'} onClick={event => onDelete(event.currentTarget)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></button>}
            <button type="button" className="btn btn-secondary" data-close aria-label="割り勘詳細を閉じる" onClick={onClose}>×</button>
          </div>
        </div>
        <dl className="event-detail-list">
          <dt>日付</dt><dd>{split.expenseDate}</dd>
          <dt>用途</dt><dd>{purposeText(split)}</dd>
          <dt>相手</dt><dd>{partnerText(split)}{split.isExternal ? '（世帯外）' : ''}</dd>
          <dt>負担額</dt><dd>{split.amountDue.toLocaleString('ja-JP')}円（{split.splitRatio}%）</dd>
          <dt>状態</dt><dd>{STATUS_LABEL[split.status]}</dd>
        </dl>
        <div className="modal-actions">
          {payer && (split.status === 'unpaid' || split.status === 'pending') && (
            <button type="button" className="btn btn-primary" disabled={working} onClick={() => onPatch('request', '請求しました')}>請求</button>
          )}
          {payer && split.status === 'payment_reported' && (
            <>
              <button type="button" className="btn btn-primary" disabled={working} onClick={event => onSettle('receive', event.currentTarget)}>受け取りました</button>
              <button type="button" className="btn btn-secondary" disabled={working} onClick={() => onPatch('request', 'まだ受け取っていないと通知しました')}>まだ受け取っていない</button>
            </>
          )}
          {payer && split.isExternal && open && (
            <button type="button" className="btn btn-secondary" disabled={working} onClick={event => onSettle('self', event.currentTarget)}>精算済みにする</button>
          )}
          {!payer && (split.status === 'unpaid' || split.status === 'requested' || split.status === 'pending') && (
            <button type="button" className="btn btn-primary" disabled={working} onClick={event => onSettle('pay', event.currentTarget)}>支払う</button>
          )}
          {!payer && (split.status === 'requested' || split.status === 'payment_reported') && (
            <button type="button" className="btn btn-secondary" disabled={working} onClick={() => onPatch('hold', '保留にしました')}>保留</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={event => onComments(event.currentTarget)}>
            コメント{split.commentCount > 0 ? `(${split.commentCount})` : ''}
          </button>
          <button data-close type="button" className="btn btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

function SplitDeleteModal({ split, working, onClose, onDelete }: { split: ExpenseSplit; working: boolean; onClose: () => void; onDelete: () => void }) {
  const close = () => { if (!working) onClose() }
  const ref = useDialog(close, '[data-cancel]')
  return <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal warikan-child-modal" role="dialog" aria-modal="true" aria-label="割り勘の内訳を削除しますか？">
      <h2>割り勘の内訳を削除しますか？</h2>
      <p className="hint">「{purposeText(split)}」（{split.amountDue}円）を削除します。この操作は取り消せません。</p>
      {split.status === 'settled' && <p className="hint">精算で記録した「割り勘精算」の収入も削除し、口座の残高を元に戻します。</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onDelete} disabled={working}>削除する</button>
        <button type="button" className="btn btn-secondary" data-cancel onClick={close} disabled={working}>キャンセル</button>
      </div>
    </div>
  </div>
}

// 相手が世帯内メンバーか世帯外の非アプリ利用者かで一覧を絞り込むタブ(S-07)。
type WorldFilter = 'all' | 'internal' | 'external'

export function WarikanPage() {
  const [splits, setSplits] = useState<ExpenseSplit[]>([])
  const [worldFilter, setWorldFilter] = useState<WorldFilter>('all')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [settlement, setSettlement] = useState<{ kind: SettlementKind; split: ExpenseSplit } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseSplit | null>(null)
  const [commentsTarget, setCommentsTarget] = useState<ExpenseSplit | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const rowTrigger = useRef<HTMLButtonElement | null>(null)
  const childTrigger = useRef<HTMLButtonElement | null>(null)
  const restoreRow = useRef(false)
  const deletedRow = useRef<HTMLButtonElement | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const childOpen = Boolean(settlement || deleteTarget || commentsTarget)
  const closeDetail = () => { restoreRow.current = true; setDetailId(null) }
  useLayoutEffect(() => {
    if (childOpen) return
    if (detailId !== null && childTrigger.current?.isConnected) {
      childTrigger.current.focus()
      childTrigger.current = null
    } else if (detailId === null && restoreRow.current) {
      restoreRow.current = false
      const target = rowTrigger.current?.isConnected ? rowTrigger.current : pageRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
      target?.focus({ preventScroll: true })
    }
  }, [childOpen, detailId])
  useLayoutEffect(() => {
    const origin = deletedRow.current
    if (!origin) return
    deletedRow.current = null
    // 削除後の一覧更新で起点が消えた場合だけ復帰を補完し、ユーザーの移動先は奪わない。
    if (!origin.isConnected && document.activeElement === document.body) {
      pageRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus({ preventScroll: true })
    }
  }, [splits])
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchSplits = useCallback(async () => {
    const response = await apiClient.get<ExpenseSplit[]>('/expense-splits')
    setSplits(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchSplits(), apiClient.get<Account[]>('/accounts')])
      .then(([splitsResult, accountsResult]) => {
        if (cancelled) return
        if (splitsResult.status === 'rejected') {
          showToast(getApiErrorMessage(splitsResult.reason, '割り勘の取得に失敗しました。時間をおいて再度お試しください'))
        }
        if (accountsResult.status === 'fulfilled') {
          setAccounts(accountsResult.value.data)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchSplits, showToast])

  const refresh = async () => {
    try {
      await fetchSplits()
    } catch (err) {
      deletedRow.current = null
      showToast(getApiErrorMessage(err, '割り勘一覧の取得に失敗しました'))
    }
  }

  const patchSplit = async (split: ExpenseSplit, path: string, successMessage: string, body?: unknown) => {
    if (working) return
    setWorking(true)
    try {
      await apiClient.patch(`/expense-splits/${split.id}/${path}`, body)
    } catch (err) {
      showToast(getApiErrorMessage(err, '操作に失敗しました'))
      setWorking(false)
      return
    }
    setWorking(false)
    setSettlement(null)
    showToast(successMessage)
    await refresh()
  }

  const handleSettlementSubmit = (accountId: number | null) => {
    if (!settlement) return
    const config = SETTLEMENT_MODAL[settlement.kind]
    void patchSplit(settlement.split, config.path, config.success, { accountId })
  }

  const handleDelete = async () => {
    if (!deleteTarget || working) return
    setWorking(true)
    let message = '割り勘の内訳を削除しました'
    try {
      // 精算済みの削除は、精算の収入を消せたかどうかを返す(元の内訳IDを記録する前の精算は消せない)。
      const response = await apiClient.delete<{ settlementLedgerRemoved?: boolean } | ''>(`/expense-splits/${deleteTarget.id}`)
      if (response.data && response.data.settlementLedgerRemoved === false) {
        message = '割り勘の内訳を削除しました。家計簿の「割り勘精算」の収入は手動で削除してください'
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, '削除に失敗しました'))
      setWorking(false)
      setDeleteTarget(null)
      return
    }
    setWorking(false)
    setDeleteTarget(null)
    deletedRow.current = rowTrigger.current
    closeDetail()
    showToast(message)
    await refresh()
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  const detail = splits.find((split) => split.id === detailId) ?? null
  const visibleSplits = splits.filter((split) => worldFilter === 'all' || (worldFilter === 'external' ? split.isExternal : !split.isExternal))
  const emptyMessage = worldFilter === 'all'
    ? '割り勘の内訳はありません'
    : `${worldFilter === 'internal' ? '世帯内' : '世帯外'}の割り勘の内訳はありません`

  return (
    <div ref={pageRef} className="page warikan-page">
      <div className="panel" data-testid="warikan-panel">
        <div className="toolbar">
          <h2>割り勘・精算</h2>
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
        </div>
        <div className="tabs" role="tablist" aria-label="相手の絞り込み">
          <button
            type="button"
            role="tab"
            aria-selected={worldFilter === 'all'}
            className={worldFilter === 'all' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setWorldFilter('all')}
          >
            すべて
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={worldFilter === 'internal'}
            className={worldFilter === 'internal' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setWorldFilter('internal')}
          >
            世帯内
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={worldFilter === 'external'}
            className={worldFilter === 'external' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setWorldFilter('external')}
          >
            世帯外
          </button>
        </div>
        {visibleSplits.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : (
          <ul className="warikan-list" aria-label="割り勘の内訳一覧">
            {visibleSplits.map((split) => (
              <li key={split.id}>
                <button
                  type="button"
                  className="list-row-button warikan-row"
                  aria-describedby={'warikan-status-' + split.id}
                  aria-label={`${split.expenseDate} ${partnerText(split)} ${split.amountDue.toLocaleString('ja-JP')}円（${purposeText(split)}）の詳細`}
                  onClick={event => { rowTrigger.current = event.currentTarget; setDetailId(split.id) }}
                >
                  <span>{split.expenseDate}</span>
                  <span>{partnerText(split)}</span>
                  <span className="warikan-row-purpose">{purposeText(split)}</span>
                  <span className="warikan-row-status" id={'warikan-status-' + split.id}>{split.role === 'payer' ? '受け取り' : '支払い'}{split.status !== 'settled' ? '予定' : ''}・{STATUS_LABEL[split.status]}</span>
                  <span className="warikan-row-amount">{split.amountDue.toLocaleString('ja-JP')}円</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail && (
        <WarikanDetailModal
          split={detail}
          hidden={!!settlement || !!deleteTarget || !!commentsTarget}
          working={working}
          onClose={closeDetail}
          onPatch={(path, message) => void patchSplit(detail, path, message)}
          onSettle={(kind, trigger) => { childTrigger.current = trigger; setSettlement({ kind, split: detail }) }}
          onDelete={trigger => { childTrigger.current = trigger; setDeleteTarget(detail) }}
          onComments={trigger => { childTrigger.current = trigger; setCommentsTarget(detail) }}
        />
      )}

      {settlement && (
        <SettlementAccountModal
          title={SETTLEMENT_MODAL[settlement.kind].title}
          description={SETTLEMENT_MODAL[settlement.kind].description}
          submitLabel={SETTLEMENT_MODAL[settlement.kind].submitLabel}
          accounts={accounts}
          submitting={working}
          onSubmit={handleSettlementSubmit}
          onClose={() => setSettlement(null)}
        />
      )}

      {deleteTarget && <SplitDeleteModal split={deleteTarget} working={working} onClose={() => setDeleteTarget(null)} onDelete={() => void handleDelete()} />}

      {commentsTarget && (
        <ExpenseSplitCommentsModal
          split={commentsTarget}
          onClose={() => setCommentsTarget(null)}
          onPosted={() => void refresh()}
        />
      )}

      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
