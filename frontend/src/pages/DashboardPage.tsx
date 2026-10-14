import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { DashboardSummary } from '../api/dashboardTypes'
import type { Recipe } from '../api/kondateTypes'
import { RecipeDetailModal } from '../components/kondate/RecipeDetailModal'
import type { Account } from '../api/kakeiboTypes'
import type { InventoryItem, ShoppingListItem } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'
import { CalendarPanel } from '../components/dashboard/CalendarPanel'
import { DayDetailModal } from '../components/dashboard/DayDetailModal'
import type { CalendarDay } from '../components/dashboard/CalendarPanel'
import { ORDERABLE_CARDS, type DashboardCard, type DisplaySettings, type OrderableCard } from '../api/userSettingsTypes'

const LIST_PREVIEW_COUNT = 8
type EventSummaryPeriod = 'today' | 'month' | 'year'
type Loadable<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' }

const EVENT_PERIOD_LABELS: Record<EventSummaryPeriod, string> = { today: '今日', month: '今月', year: '今年' }

// カード内の一覧を取得状態ごとに出し分ける(読み込み中・取得失敗・空・先頭N件+残件数)。
function PreviewList<T>({ label, state, emptyText, render }: { label: string; state: Loadable<T[]>; emptyText: string; render: (item: T) => ReactNode }) {
  if (state.status === 'loading') return <p>読み込み中...</p>
  if (state.status === 'error') return <p className="error">{label}を取得できませんでした</p>
  if (state.data.length === 0) return <p>{emptyText}</p>
  const rest = state.data.length - LIST_PREVIEW_COUNT
  return (
    <>
      <ul className="dashboard-list" aria-label={label}>{state.data.slice(0, LIST_PREVIEW_COUNT).map(render)}</ul>
      {rest > 0 && <p className="dashboard-list-more">ほか{rest}件</p>}
    </>
  )
}

function accountTotal(accounts: Account[]): number {
  return accounts.reduce((total, account) => {
    const chargeCardBalance = account.cards
      .filter((card) => card.cardType === 'charge')
      .reduce((cardTotal, card) => cardTotal + card.balance, 0)
    return total + account.balance + chargeCardBalance
  }, 0)
}

export function DashboardPage() {
  const [summary, setSummary] = useState<Loadable<DashboardSummary>>({ status: 'loading' })
  const [eventSummaryPeriod, setEventSummaryPeriod] = useState<EventSummaryPeriod>('year')
  const [eventSummaries, setEventSummaries] = useState<Loadable<DashboardSummary['eventExpenseSummaries']>>({ status: 'loading' })
  const [shoppingList, setShoppingList] = useState<Loadable<ShoppingListItem[]>>({ status: 'loading' })
  const [inventory, setInventory] = useState<Loadable<InventoryItem[]>>({ status: 'loading' })
  const [accountBalanceTotal, setAccountBalanceTotal] = useState<Loadable<number>>({ status: 'loading' })
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings | null>(null)
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const recipeRequest = useRef<AbortController | null>(null)
  const recipeTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => () => {
    recipeRequest.current?.abort()
    recipeRequest.current = null
  }, [])

  const openRecipe = async (recipeId: number, trigger: HTMLButtonElement) => {
    if (recipeRequest.current) return
    const controller = new AbortController()
    recipeRequest.current = controller
    recipeTrigger.current = trigger
    setRecipeLoading(true)
    try {
      const response = await apiClient.get<Recipe[]>('/recipes', { signal: controller.signal })
      if (controller.signal.aborted) return
      const recipe = response.data.find((item) => item.id === recipeId)
      if (recipe) setSelectedRecipe(recipe)
      else setToast((prev) => ({ message: 'レシピが見つかりませんでした', showKey: prev.showKey + 1 }))
    } catch (error) {
      if (!controller.signal.aborted) {
        setToast((prev) => ({ message: getApiErrorMessage(error, 'レシピの取得に失敗しました。時間をおいて再度お試しください'), showKey: prev.showKey + 1 }))
      }
    } finally {
      if (!controller.signal.aborted) {
        recipeRequest.current = null
        setRecipeLoading(false)
      }
    }
  }

  const closeRecipe = () => {
    setSelectedRecipe(null)
    recipeTrigger.current?.focus()
  }
  useEffect(() => { apiClient.get<DisplaySettings>('/user-settings').then((response) => setDisplaySettings(response.data)).catch(() => undefined) }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      apiClient.get<DashboardSummary>('/dashboard/summary'),
      apiClient.get<ShoppingListItem[]>('/shopping-list-items'),
      apiClient.get<InventoryItem[]>('/inventory-items'),
      apiClient.get<Account[]>('/accounts'),
    ]).then(([summaryResult, shoppingResult, inventoryResult, accountsResult]) => {
      if (cancelled) return
      const errorMessages: string[] = []

      if (summaryResult.status === 'fulfilled') {
        setSummary({ status: 'ok', data: summaryResult.value.data })
      } else {
        setSummary({ status: 'error' })
        errorMessages.push(getApiErrorMessage(summaryResult.reason, 'ダッシュボードの取得に失敗しました。時間をおいて再度お試しください'))
      }

      if (shoppingResult.status === 'fulfilled') {
        setShoppingList({ status: 'ok', data: shoppingResult.value.data.filter((item) => !item.purchased) })
      } else {
        setShoppingList({ status: 'error' })
        errorMessages.push(getApiErrorMessage(shoppingResult.reason, '買い物リストの取得に失敗しました。時間をおいて再度お試しください'))
      }

      if (inventoryResult.status === 'fulfilled') {
        setInventory({ status: 'ok', data: inventoryResult.value.data })
      } else {
        setInventory({ status: 'error' })
        errorMessages.push(getApiErrorMessage(inventoryResult.reason, '在庫情報の取得に失敗しました。時間をおいて再度お試しください'))
      }

      if (accountsResult.status === 'fulfilled') {
        setAccountBalanceTotal({ status: 'ok', data: accountTotal(accountsResult.value.data) })
      } else {
        setAccountBalanceTotal({ status: 'error' })
        errorMessages.push(getApiErrorMessage(accountsResult.reason, '口座情報の取得に失敗しました。時間をおいて再度お試しください'))
      }

      if (errorMessages.length > 0) {
        setToast((prev) => ({ message: errorMessages.join('、'), showKey: prev.showKey + 1 }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // イベント別支出は期間セレクトに応じて、このカードの集計だけを取り直す。
  useEffect(() => {
    let cancelled = false
    apiClient
      .get<DashboardSummary>('/dashboard/summary', { params: { eventPeriod: eventSummaryPeriod } })
      .then((response) => {
        if (!cancelled) setEventSummaries({ status: 'ok', data: response.data.eventExpenseSummaries })
      })
      .catch(() => {
        if (!cancelled) setEventSummaries({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [eventSummaryPeriod])

  const changeEventPeriod = (period: EventSummaryPeriod) => {
    setEventSummaries({ status: 'loading' })
    setEventSummaryPeriod(period)
  }

  const cardOrder = displaySettings?.cardOrder ?? ORDERABLE_CARDS
  const showCard = (card: DashboardCard) => displaySettings?.cards[card] !== false
  const items = displaySettings?.items
  const summaryData = summary.status === 'ok' ? summary.data : null
  const summaryFallback = summary.status === 'loading' ? <p>読み込み中...</p> : <p className="error">集計を取得できませんでした</p>

  const cardContents: Record<OrderableCard, ReactNode> = {
    today: (
      <div className="card" key="today">
        <h2>今日の状況</h2>
        {summaryData ? (
          <>
            {items?.today.balance !== false && <p>収支: {summaryData.todayBalance}円</p>}
            {items?.today.menu !== false &&
              (summaryData.weeklyMenuEntries.length ? (
                <>
                  <p>今週の献立</p>
                  <ul className="dashboard-list" aria-label="今週の献立">
                    {summaryData.weeklyMenuEntries.map((entry, index) => (
                      <li key={index}>
                        {entry.recipeId !== null && entry.recipeTitle ? (
                          <button type="button" className="dashboard-recipe-button" disabled={recipeLoading}
                            onClick={(event) => void openRecipe(entry.recipeId!, event.currentTarget)}>
                            {entry.recipeTitle}
                          </button>
                        ) : entry.recipeTitle ?? entry.freeTextMemo ?? '削除されたレシピ'}
                      </li>
                    ))}
                  </ul>
                  {recipeLoading && <p role="status">レシピを読み込み中...</p>}
                </>
              ) : (
                <p>今週の献立: なし</p>
              ))}
            {items?.today.events !== false && <p>イベント: {summaryData.todayEvents.map((event) => event.name).join('・') || 'なし'}</p>}
          </>
        ) : summaryFallback}
      </div>
    ),
    stock: (
      <div className="card" key="stock">
        <h2>買い物・在庫</h2>
        {items?.stock.shoppingList !== false && (
          <>
            <h3>買い物リスト</h3>
            <PreviewList
              label="買い物リスト"
              state={shoppingList}
              emptyText="買い物リストは空です"
              render={(item) => <li key={item.id}><Link to="/zaiko">{item.name}</Link></li>}
            />
          </>
        )}
        {items?.stock.inventoryList !== false && (
          <>
            <h3>在庫リスト</h3>
            <PreviewList
              label="在庫リスト"
              state={inventory}
              emptyText="在庫は登録されていません"
              render={(item) => (
                <li key={item.id}>
                  <Link to="/zaiko">{item.name}</Link> 残{item.quantity}
                  {item.quantity < item.threshold && <span className="dashboard-low-stock">（不足）</span>}
                </li>
              )}
            />
          </>
        )}
        <Link to="/zaiko">在庫・買い物リストを見る</Link>
      </div>
    ),
    finance: (
      <div className="card" key="finance">
        <h2>個人の財政</h2>
        <p>
          口座残高合計:{' '}
          {accountBalanceTotal.status === 'ok' ? `${accountBalanceTotal.data}円` : accountBalanceTotal.status === 'loading' ? '読み込み中...' : '取得できませんでした'}
        </p>
        <Link to="/accounts">口座・カード管理を見る</Link>
      </div>
    ),
    money: (
      <div className="card" key="money">
        <h2>今月のお金</h2>
        {summaryData ? (
          <>
            {items?.money.personal !== false && <p>個人支出: {summaryData.monthlyPersonalExpense}円</p>}
            {items?.money.householdTotal !== false && <p>世帯合計対象額: {summaryData.householdExpenseTotal}円</p>}
            {items?.money.unsettled !== false && (
              <>
                <p>受取予定: {summaryData.unsettledReceivable.count}件・{summaryData.unsettledReceivable.total}円</p>
                <p>支払予定: {summaryData.unsettledPayable.count}件・{summaryData.unsettledPayable.total}円</p>
              </>
            )}
          </>
        ) : summaryFallback}
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
          onChange={(event) => changeEventPeriod(event.target.value as EventSummaryPeriod)}
        >
          {(['today', 'month', 'year'] as const).map((period) => <option key={period} value={period}>{EVENT_PERIOD_LABELS[period]}</option>)}
        </select>
        {eventSummaries.status === 'loading' ? (
          <p>集計中...</p>
        ) : eventSummaries.status === 'error' ? (
          <p className="error">イベント別支出を取得できませんでした</p>
        ) : eventSummaries.data.length ? (
          <ul className="dashboard-list" aria-label={`イベント別支出（${EVENT_PERIOD_LABELS[eventSummaryPeriod]}）`}>
            {eventSummaries.data.map((event) => <li key={event.eventId}>{event.name}: {event.total}円</li>)}
          </ul>
        ) : (
          <p>イベント別支出: なし</p>
        )}
        <Link to="/events">イベント一覧を見る</Link>
      </div>
    ),
  }

  const visibleCards = cardOrder.filter(showCard)

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
        {visibleCards.length > 0 && <div className="dashboard-summary-grid">{visibleCards.map((card) => cardContents[card])}</div>}
        {visibleCards.length === 0 && !showCard('calendar') && (
          <p className="dashboard-empty">
            表示するカードがありません。<Link to="/settings/display">表示設定を開く</Link>
          </p>
        )}
      </div>
      {selectedDay && <DayDetailModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
      {selectedRecipe && <RecipeDetailModal recipe={selectedRecipe} onClose={closeRecipe} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
