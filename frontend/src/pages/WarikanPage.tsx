import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { ExpenseSplit, SplitStatus } from '../api/warikanTypes'
import { Toast } from '../components/Toast'

const STATUS_LABEL: Record<SplitStatus, string> = {
  unpaid: '未請求',
  requested: '請求中',
  approval_requested: '受領承認待ち',
  pending: '保留中',
  settled: '精算済み',
}

// 確認ダイアログを挟む操作(取り消しづらい・お金が動く操作)。
type ConfirmAction = 'approve' | 'settle-self' | 'delete'

interface Confirm {
  action: ConfirmAction
  split: ExpenseSplit
}

const CONFIRM_TEXT: Record<ConfirmAction, { title: string; body: string; button: string }> = {
  approve: { title: '精算を承認しますか？', body: '承認すると「精算済み」になります。この操作は取り消せません。', button: '承認する' },
  'settle-self': {
    title: '精算済みにしますか？',
    body: '世帯外の相手との精算を自己申告で「精算済み」にします。この操作は取り消せません。',
    button: '精算済みにする',
  },
  delete: { title: '割り勘の内訳を削除しますか？', body: 'この内訳を削除します。この操作は取り消せません。', button: '削除する' },
}

export function WarikanPage() {
  const [splits, setSplits] = useState<ExpenseSplit[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
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
    fetchSplits()
      .catch((err: unknown) => {
        if (!cancelled) showToast(getApiErrorMessage(err, '割り勘の取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchSplits, showToast])

  const runAction = async (split: ExpenseSplit, path: string, method: 'PATCH' | 'DELETE', successMessage: string) => {
    setWorking(true)
    try {
      if (method === 'DELETE') {
        await apiClient.delete(`/expense-splits/${split.id}`)
      } else {
        await apiClient.patch(`/expense-splits/${split.id}/${path}`)
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, '操作に失敗しました'))
      setWorking(false)
      setConfirm(null)
      return
    }
    setWorking(false)
    setConfirm(null)
    showToast(successMessage)
    try {
      await fetchSplits()
    } catch (err) {
      showToast(getApiErrorMessage(err, '割り勘一覧の取得に失敗しました'))
    }
  }

  const handleConfirm = () => {
    if (!confirm) return
    if (confirm.action === 'approve') {
      void runAction(confirm.split, 'approve', 'PATCH', '精算を承認しました')
    } else if (confirm.action === 'settle-self') {
      void runAction(confirm.split, 'settle-self', 'PATCH', '精算済みにしました')
    } else {
      void runAction(confirm.split, '', 'DELETE', '割り勘の内訳を削除しました')
    }
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
                  <td>{split.expensePurpose}</td>
                  <td>
                    {split.role === 'payer' ? `${split.debtorLabel} へ請求` : `${split.payerLabel} へ支払`}
                  </td>
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
                            onClick={() => void runAction(split, 'request', 'PATCH', '請求しました')}
                          >
                            請求
                          </button>
                        )}
                        {(split.status === 'requested' || split.status === 'pending') && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => void runAction(split, 'receipt-request', 'PATCH', '受領申請しました')}
                          >
                            受領申請
                          </button>
                        )}
                        {split.isExternal && split.status !== 'settled' && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => setConfirm({ action: 'settle-self', split })}
                          >
                            精算済みにする
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-tiny"
                          disabled={working}
                          onClick={() => setConfirm({ action: 'delete', split })}
                        >
                          削除
                        </button>
                      </>
                    )}
                    {split.role === 'debtor' && (
                      <>
                        {split.status === 'approval_requested' && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => setConfirm({ action: 'approve', split })}
                          >
                            承認
                          </button>
                        )}
                        {(split.status === 'requested' || split.status === 'approval_requested') && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={working}
                            onClick={() => void runAction(split, 'hold', 'PATCH', '保留にしました')}
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

      {confirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{CONFIRM_TEXT[confirm.action].title}</h2>
            <p className="hint">
              「{confirm.split.expensePurpose}」（{confirm.split.amountDue}円）：{CONFIRM_TEXT[confirm.action].body}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={working}>
                {CONFIRM_TEXT[confirm.action].button}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)} disabled={working}>
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
