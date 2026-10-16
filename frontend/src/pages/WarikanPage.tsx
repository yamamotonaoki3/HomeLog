import { useCallback, useEffect, useState } from 'react'
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
  onSettle: (kind: SettlementKind) => void
  onDelete: () => void
  onComments: () => void
}) {
  const ref = useDialog(onClose, '[data-close]')
  const payer = split.role === 'payer'
  const open = split.status !== 'settled'
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="割り勘詳細" hidden={hidden} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} className="modal event-modal">
        <h2>割り勘詳細</h2>
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
              <button type="button" className="btn btn-primary" disabled={working} onClick={() => onSettle('receive')}>受け取りました</button>
              <button type="button" className="btn btn-secondary" disabled={working} onClick={() => onPatch('request', 'まだ受け取っていないと通知しました')}>まだ受け取っていない</button>
            </>
          )}
          {payer && split.isExternal && open && (
            <button type="button" className="btn btn-secondary" disabled={working} onClick={() => onSettle('self')}>精算済みにする</button>
          )}
          {!payer && (split.status === 'unpaid' || split.status === 'requested' || split.status === 'pending') && (
            <button type="button" className="btn btn-primary" disabled={working} onClick={() => onSettle('pay')}>支払う</button>
          )}
          {!payer && (split.status === 'requested' || split.status === 'payment_reported') && (
            <button type="button" className="btn btn-secondary" disabled={working} onClick={() => onPatch('hold', '保留にしました')}>保留</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onComments}>
            コメント{split.commentCount > 0 ? `(${split.commentCount})` : ''}
          </button>
          {payer && open && (
            <button type="button" className="btn btn-secondary" disabled={working} onClick={onDelete}>削除</button>
          )}
          <button data-close type="button" className="btn btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
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
      showToast(getApiErrorMessage(err, '割り勘一覧の取得に失敗しました'))
    }
  }

  const patchSplit = async (split: ExpenseSplit, path: string, successMessage: string, body?: unknown) => {
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
    if (!deleteTarget) return
    setWorking(true)
    try {
      await apiClient.delete(`/expense-splits/${deleteTarget.id}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, '削除に失敗しました'))
      setWorking(false)
      setDeleteTarget(null)
      return
    }
    setWorking(false)
    setDeleteTarget(null)
    setDetailId(null)
    showToast('割り勘の内訳を削除しました')
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
    <div className="page warikan-page">
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
                  aria-label={`${split.expenseDate} ${partnerText(split)} ${split.amountDue.toLocaleString('ja-JP')}円（${purposeText(split)}）の詳細`}
                  onClick={() => setDetailId(split.id)}
                >
                  <span>{split.expenseDate}</span>
                  <span>{partnerText(split)}</span>
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
          onClose={() => setDetailId(null)}
          onPatch={(path, message) => void patchSplit(detail, path, message)}
          onSettle={(kind) => setSettlement({ kind, split: detail })}
          onDelete={() => setDeleteTarget(detail)}
          onComments={() => setCommentsTarget(detail)}
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

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>割り勘の内訳を削除しますか？</h2>
            <p className="hint">
              「{purposeText(deleteTarget)}」（{deleteTarget.amountDue}円）を削除します。この操作は取り消せません。
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleDelete} disabled={working}>
                削除する
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={working}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

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
