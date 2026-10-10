import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { DashboardSummary } from '../api/dashboardTypes'
import type { Account } from '../api/kakeiboTypes'
import type { InventoryItem } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'
import { CalendarPanel } from '../components/dashboard/CalendarPanel'
import { DayDetailModal } from '../components/dashboard/DayDetailModal'
import type { CalendarDay } from '../components/dashboard/CalendarPanel'
import { ORDERABLE_CARDS, type DashboardCard, type DisplaySettings, type OrderableCard } from '../api/userSettingsTypes'

const COMMON_ITEMS_COUNT = 3
type EventSummaryPeriod = 'year' | 'month'

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [eventSummaryPeriod, setEventSummaryPeriod] = useState<EventSummaryPeriod>('year')
  const [commonItems, setCommonItems] = useState('')
  const [accountBalanceTotal, setAccountBalanceTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings | null>(null)
  useEffect(() => { apiClient.get<DisplaySettings>('/user-settings').then((response) => setDisplaySettings(response.data)).catch(() => undefined) }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      apiClient.get<DashboardSummary>('/dashboard/summary', { params: { eventPeriod: eventSummaryPeriod } }),
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
  }, [eventSummaryPeriod])

  if (loading) {
    return <p>読み込み中...</p>
  }

  const cardOrder = displaySettings?.cardOrder ?? ORDERABLE_CARDS
  const showCard = (card: DashboardCard) => displaySettings?.cards[card] !== false
  const items = displaySettings?.items

  const cardContents: Record<OrderableCard, ReactNode> = {
    today: (
      <div className="card" key="today">
        <h2>今日の状況</h2>
        {items?.today.balance !== false && <p>収支: {summary?.todayBalance ?? 0}円</p>}
        {items?.today.menu !== false && <p>今週の献立: {summary?.weeklyMenuEntries.map((entry) => entry.recipeTitle ?? entry.freeTextMemo).filter(Boolean).join('・') || 'なし'}</p>}
        {items?.today.events !== false && <p>イベント: {summary?.todayEvents.map((event) => event.name).join('・') || 'なし'}</p>}
      </div>
    ),
    stock: (
      <div className="card" key="stock">
        <h2>買い物・在庫</h2>
        {summary && (
          <>
            {items?.stock.shoppingList !== false && <p>買い物リスト: {summary.shoppingListCount}件</p>}
            {items?.stock.inventoryList !== false && <p>在庫不足: {summary.lowStockCount}件</p>}
            <Link to="/zaiko">買い物リストを見る</Link>
          </>
        )}
        <p>よく使う品目: {commonItems || 'なし'}</p>
      </div>
    ),
    finance: (
      <div className="card" key="finance">
        <h2>個人の財政</h2>
        <p>
          口座残高合計: {accountBalanceTotal}円　<Link to="/accounts">口座・カード管理を見る</Link>
        </p>
      </div>
    ),
    money: (
      <div className="card" key="money">
        <h2>今月のお金</h2>
        {/* 移行完了までの間はJava版バックエンドがhouseholdExpenseTotalを返さないため、
            未定義時は0円表示にフォールバックする(Phase 6での接続先切り替え後は常に値が入る)。 */}
        {items?.money.personal !== false && <p>個人支出: {summary?.monthlyPersonalExpense ?? 0}円</p>}
        {items?.money.householdTotal !== false && <p>世帯合計対象額: {summary?.householdExpenseTotal ?? 0}円</p>}
        {items?.money.unsettled !== false && (
          <>
            <p>受取予定: {summary?.unsettledReceivable?.count ?? 0}件・{summary?.unsettledReceivable?.total ?? 0}円</p>
            <p>支払予定: {summary?.unsettledPayable?.count ?? 0}件・{summary?.unsettledPayable?.total ?? 0}円</p>
          </>
        )}
        <Link to="/warikan">精算一覧を見る</Link>
      </div>
    ),
    eventExpenses: (
      <div className="card" key="eventExpenses">
        <h2>イベント別支出</h2>
        <label htmlFor="dashboard-event-period">イベント別支出（対象期間）</label>
        <select
          id="dashboard-event-period"
          value={eventSummaryPeriod}
          onChange={(event) => setEventSummaryPeriod(event.target.value as EventSummaryPeriod)}
        >
          <option value="year">今年</option>
          <option value="month">今月</option>
        </select>
        {summary?.eventExpenseSummaries.length ? <><p>イベント別支出:</p>{summary.eventExpenseSummaries.map((event) => <p key={event.eventId}>{event.name}: {event.total}円</p>)}</> : <p>イベント別支出: なし</p>}
        <Link to="/events">イベント一覧を見る</Link>
      </div>
    ),
  }

  return (
    <div className="page">
      <div className="dashboard-layout">
        {showCard('calendar') && (
          <CalendarPanel
            onSelectDate={setSelectedDay}
            showEvents={items?.calendar.events !== false}
            showIncome={items?.calendar.income !== false}
            showExpense={items?.calendar.expense !== false}
          />
        )}
        <div className="dashboard-summary-grid">{cardOrder.filter(showCard).map((card) => cardContents[card])}</div>
      </div>
      {selectedDay && <DayDetailModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
