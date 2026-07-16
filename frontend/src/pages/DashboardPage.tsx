import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { DashboardSummary } from '../api/dashboardTypes'
import type { InventoryItem } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'

const COMMON_ITEMS_COUNT = 3

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [commonItems, setCommonItems] = useState('')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiClient.get<DashboardSummary>('/dashboard/summary'),
      apiClient.get<InventoryItem[]>('/inventory-items'),
    ])
      .then(([summaryRes, inventoryRes]) => {
        if (cancelled) return
        setSummary(summaryRes.data)
        setCommonItems(
          inventoryRes.data
            .slice(0, COMMON_ITEMS_COUNT)
            .map((item) => item.name)
            .join('・'),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setToast((prev) => ({
            message: getApiErrorMessage(err, 'ダッシュボードの取得に失敗しました。時間をおいて再度お試しください'),
            showKey: prev.showKey + 1,
          }))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="dashboard-sidebar">
        <div className="card">
          <h2>買い物・在庫</h2>
          {summary && (
            <>
              <p>買い物リスト: {summary.shoppingListCount}件</p>
              <p>
                在庫不足: {summary.lowStockCount}件　<Link to="/zaiko">買い物リストを見る</Link>
              </p>
            </>
          )}
          <p>よく使う品目: {commonItems || 'なし'}</p>
        </div>
      </div>
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
