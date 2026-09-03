import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account } from '../api/kakeiboTypes'
import type { ExpenseSplit, SplitStatus } from '../api/warikanTypes'
import { Toast } from '../components/Toast'
import { SettlementAccountModal } from '../components/warikan/SettlementAccountModal'

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

export function WarikanPage() {
  const [splits, setSplits] = useState<ExpenseSplit[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [settlement, setSettlement] = useState<{ kind: SettlementKind; split: ExpenseSplit } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseSplit | null>(null)
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
    showToast('割り勘の内訳を削除しました')
    await refresh()
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="warikan-panel">
        <div className="toolbar">
          <h2>割り勘・精算</h2>
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>日付</th>
              <th>用途</th>
              <th>相手</th>
              <th>負担額</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {splits.length === 0 ? (
              <tr>
                <td colSpan={6}>割り勘の内訳はありません</td>
              </tr>
            ) : (
              splits.map((split) => (
                <tr key={split.id}>
                  <td>{split.expenseDate}</td>
                  <td>{purposeText(split)}</td>
                  <td>{split.role === 'payer' ? `${split.debtorLabel} へ請求` : `${split.payerLabel} へ支払`}</td>
                  <td>
                    {split.amountDue}円（{split.splitRatio}%）
                  </td>
                  <td>{STATUS_LABEL[split.status]}</td>
                  <td>
                    {split.role === 'payer' && (
                      <>
                        {(split.status === 'unpaid' || split.status === 'pending') && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => void patchSplit(split, 'request', '請求しました')}
                          >
                            請求
                          </button>
                        )}
                        {split.status === 'payment_reported' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-tiny"
                              disabled={working}
                              onClick={() => setSettlement({ kind: 'receive', split })}
                            >
                              受け取りました
                            </button>
                            <button
                              type="button"
                              className="btn btn-tiny"
                              disabled={working}
                              onClick={() => void patchSplit(split, 'request', 'まだ受け取っていないと通知しました')}
                            >
                              まだ受け取っていない
                            </button>
                          </>
                        )}
                        {split.isExternal && split.status !== 'settled' && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => setSettlement({ kind: 'self', split })}
                          >
                            精算済みにする
                          </button>
                        )}
                        {split.status !== 'settled' && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => setDeleteTarget(split)}
                          >
                            削除
                          </button>
                        )}
                      </>
                    )}
                    {split.role === 'debtor' && (
                      <>
                        {(split.status === 'unpaid' || split.status === 'requested' || split.status === 'pending') && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => setSettlement({ kind: 'pay', split })}
                          >
                            支払う
                          </button>
                        )}
                        {(split.status === 'requested' || split.status === 'payment_reported') && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => void patchSplit(split, 'hold', '保留にしました')}
                          >
                            保留
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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

      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
