import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { FixedCost } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { FixedCostModal } from '../components/kakeibo/FixedCostModal'

export function FixedCostsPage() {
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState<FixedCost | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<FixedCost | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchFixedCosts = useCallback(async () => {
    const response = await apiClient.get<FixedCost[]>('/fixed-costs')
    setFixedCosts(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchFixedCosts()
      .catch((err: unknown) => {
        if (!cancelled) {
          showToast(getApiErrorMessage(err, '固定費の取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchFixedCosts, showToast])

  const handleSaved = async () => {
    const wasEdit = modalTarget != null
    try {
      await fetchFixedCosts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費一覧の取得に失敗しました'))
      throw err
    }
    setModalTarget(undefined)
    showToast(wasEdit ? '固定費を更新しました' : '固定費を登録しました')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiClient.delete(`/fixed-costs/${deleteTarget.id}`)
      await fetchFixedCosts()
      showToast('固定費を削除しました')
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費の削除に失敗しました'))
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="fixed-costs-panel">
        <div className="toolbar">
          <h2>固定費管理</h2>
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => setModalTarget(null)}>
            固定費を登録
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>固定費名</th>
              <th>金額</th>
              <th>支払日</th>
              <th>公開範囲</th>
              <th>世帯合計対象</th>
              <th>割り勘</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {fixedCosts.length === 0 ? (
              <tr>
                <td colSpan={7}>固定費はありません</td>
              </tr>
            ) : (
              fixedCosts.map((fixedCost) => (
                <tr key={fixedCost.id}>
                  <td>{fixedCost.name}</td>
                  <td>{fixedCost.amount}円</td>
                  <td>{fixedCost.paymentDay}日</td>
                  <td>{fixedCost.personal ? '個人' : '世帯共有'}</td>
                  <td>{fixedCost.includeInHouseholdTotal ? '○' : ''}</td>
                  <td></td>
                  <td>
                    {fixedCost.editable && (
                      <>
                        <button type="button" className="btn btn-tiny" onClick={() => setModalTarget(fixedCost)}>
                          編集
                        </button>
                        <button type="button" className="btn btn-tiny" onClick={() => setDeleteTarget(fixedCost)}>
                          削除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {modalTarget !== undefined && (
        <FixedCostModal fixedCost={modalTarget} onClose={() => setModalTarget(undefined)} onSaved={handleSaved} />
      )}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>固定費を削除しますか？</h2>
            <p className="hint">「{deleteTarget.name}」を削除します。この操作は取り消せません。</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleDelete} disabled={deleting}>
                削除する
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
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
