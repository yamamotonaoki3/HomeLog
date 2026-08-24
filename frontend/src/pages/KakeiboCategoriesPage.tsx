import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { IncomeCategory, KakeiboCategory } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { CategoryModal } from '../components/kakeibo/CategoryModal'

type TabKind = 'expense' | 'income'
type CategoryLike = KakeiboCategory | IncomeCategory

interface ModalTarget {
  kind: TabKind
  category: CategoryLike | null
}

interface DeleteTarget {
  kind: TabKind
  category: CategoryLike
}

export function KakeiboCategoriesPage() {
  const [activeTab, setActiveTab] = useState<TabKind>('expense')
  const [expenseCategories, setExpenseCategories] = useState<KakeiboCategory[]>([])
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState<ModalTarget | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchExpenseCategories = useCallback(async () => {
    const response = await apiClient.get<KakeiboCategory[]>('/kakeibo-categories')
    setExpenseCategories(response.data)
  }, [])

  const fetchIncomeCategories = useCallback(async () => {
    const response = await apiClient.get<IncomeCategory[]>('/income-categories')
    setIncomeCategories(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchExpenseCategories(), fetchIncomeCategories()])
      .then(([expenseResult, incomeResult]) => {
        if (cancelled) return
        if (expenseResult.status === 'rejected') {
          showToast(
            getApiErrorMessage(expenseResult.reason, 'カテゴリーの取得に失敗しました。時間をおいて再度お試しください'),
          )
        }
        if (incomeResult.status === 'rejected') {
          showToast(
            getApiErrorMessage(incomeResult.reason, 'カテゴリーの取得に失敗しました。時間をおいて再度お試しください'),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchExpenseCategories, fetchIncomeCategories, showToast])

  const handleSaved = async () => {
    if (!modalTarget) return
    const { kind, category } = modalTarget
    const wasEdit = category !== null
    try {
      if (kind === 'expense') await fetchExpenseCategories()
      else await fetchIncomeCategories()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'カテゴリー一覧の取得に失敗しました'))
      throw err
    }
    setModalTarget(undefined)
    showToast(wasEdit ? 'カテゴリーを更新しました' : 'カテゴリーを登録しました')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const { kind, category } = deleteTarget
    const endpointBase = kind === 'expense' ? '/kakeibo-categories' : '/income-categories'
    setDeleting(true)
    try {
      await apiClient.delete(`${endpointBase}/${category.id}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'カテゴリーの削除に失敗しました'))
      setDeleting(false)
      setDeleteTarget(null)
      return
    }
    if (kind === 'expense') {
      setExpenseCategories((prev) => prev.filter((c) => c.id !== category.id))
    } else {
      setIncomeCategories((prev) => prev.filter((c) => c.id !== category.id))
    }
    setDeleting(false)
    setDeleteTarget(null)
    showToast('カテゴリーを削除しました')
    try {
      if (kind === 'expense') await fetchExpenseCategories()
      else await fetchIncomeCategories()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'カテゴリー一覧の取得に失敗しました'))
    }
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  const activeCategories = activeTab === 'expense' ? expenseCategories : incomeCategories
  const label = activeTab === 'expense' ? '支出カテゴリー' : '収入カテゴリー'

  return (
    <div className="page">
      <div className="panel" data-testid="kakeibo-categories-panel">
        <div className="toolbar">
          <h2>家計簿カテゴリー管理</h2>
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => setModalTarget({ kind: activeTab, category: null })}>
            {label}を登録
          </button>
        </div>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'expense'}
            className={activeTab === 'expense' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setActiveTab('expense')}
          >
            支出カテゴリー
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'income'}
            className={activeTab === 'income' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setActiveTab('income')}
          >
            収入カテゴリー
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>カテゴリー名</th>
              <th>種別</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {activeCategories.length === 0 ? (
              <tr>
                <td colSpan={3}>カテゴリーはありません</td>
              </tr>
            ) : (
              activeCategories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.isDefault ? 'デフォルト' : 'カスタム'}</td>
                  <td>
                    {!category.isDefault && (
                      <>
                        <button
                          type="button"
                          className="btn btn-tiny"
                          onClick={() => setModalTarget({ kind: activeTab, category })}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="btn btn-tiny"
                          onClick={() => setDeleteTarget({ kind: activeTab, category })}
                        >
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
        <CategoryModal
          kind={modalTarget.kind}
          category={modalTarget.category}
          onClose={() => setModalTarget(undefined)}
          onSaved={handleSaved}
        />
      )}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>カテゴリーを削除しますか？</h2>
            <p className="hint">「{deleteTarget.category.name}」を削除します。この操作は取り消せません。</p>
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
