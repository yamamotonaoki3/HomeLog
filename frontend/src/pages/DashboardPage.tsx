import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { DashboardSummary } from '../api/dashboardTypes'
import type { Account } from '../api/kakeiboTypes'
import type { InventoryItem } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'

const COMMON_ITEMS_COUNT = 3

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [commonItems, setCommonItems] = useState('')
  const [accountBalanceTotal, setAccountBalanceTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      apiClient.get<DashboardSummary>('/dashboard/summary'),
      apiClient.get<InventoryItem[]>('/inventory-items'),
      apiClient.get<Account[]>('/accounts'),
    ])
      .then(([summaryResult, inventoryResult, accountsResult]) => {
        if (cancelled) return

        const errorMessages: string[] = []

        if (summaryResult.status === 'fulfilled') {
          setSummary(summaryResult.value.data)
        } else {
          errorMessages.push(
            getApiErrorMessage(
              summaryResult.reason,
              'ダッシュボードの取得に失敗しました。時間をおいて再度お試しください',
            ),
          )
        }

        if (inventoryResult.status === 'fulfilled') {
          setCommonItems(
            inventoryResult.value.data
            .slice(0, COMMON_ITEMS_COUNT)
            .map((item) => item.name)
            .join('・'),
          )
        } else {
          errorMessages.push(
            getApiErrorMessage(
              inventoryResult.reason,
              '在庫情報の取得に失敗しました。時間をおいて再度お試しください',
            ),
          )
        }

        if (accountsResult.status === 'fulfilled') {
          setAccountBalanceTotal(
            accountsResult.value.data.reduce((total, account) => {
              const chargeCardBalance = account.cards
                .filter((card) => card.cardType === 'charge')
                .reduce((cardTotal, card) => cardTotal + card.balance, 0)
              return total + account.balance + chargeCardBalance
            }, 0),
          )
        } else {
          errorMessages.push(
            getApiErrorMessage(
              accountsResult.reason,
              '口座情報の取得に失敗しました。時間をおいて再度お試しください',
            ),
          )
        }

        if (errorMessages.length > 0) {
          setToast((prev) => ({
            message: errorMessages.join('、'),
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
        <div className="card">
          <h2>個人の財政</h2>
          <p>
            口座残高合計: {accountBalanceTotal}円　<Link to="/accounts">口座・カード管理を見る</Link>
          </p>
        </div>
        <div className="card">
          <h2>今月のお金</h2>
          {summary && <p>世帯合計支出額(今月): {summary.householdExpenseTotal}円</p>}
        </div>
      </div>
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
