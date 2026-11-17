import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { DashboardSummary } from '../api/dashboardTypes'
import type { Account } from '../api/kakeiboTypes'
import type { InventoryItem, ShoppingListItem } from '../api/zaikoTypes'
import { formatPrice } from '../components/zaiko/price'
import { Toast } from '../components/Toast'
import { CalendarPanel } from '../components/dashboard/CalendarPanel'
import { DayDetailModal } from '../components/dashboard/DayDetailModal'
import type { CalendarDay } from '../components/dashboard/CalendarPanel'
import { ORDERABLE_CARDS, type DashboardCard, type DisplaySettings, type OrderableCard } from '../api/userSettingsTypes'
import { AuthContext } from '../context/authContextValue'
import { readCollapsedCards, writeCollapsedCards } from '../lib/dashboardCollapsedCards'

const LIST_PREVIEW_COUNT = 8
type EventSummaryPeriod = 'today' | 'month' | 'year'
type Loadable<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' }

const EVENT_PERIOD_LABELS: Record<EventSummaryPeriod, string> = { today: '今日', month: '今月', year: '今年' }

// カード内の一覧を取得状態ごとに出し分ける(読み込み中・取得失敗・空・先頭N件+残件数)。
function PreviewList<T>({ label, state, emptyText, valueLabel, render }: { label: string; state: Loadable<T[]>; emptyText: string; valueLabel: string; render: (item: T) => ReactNode }) {
  if (state.status === 'loading') return <p>読み込み中...</p>
  if (state.status === 'error') return <p className="error">{label}を取得できませんでした</p>
  if (state.data.length === 0) return <p>{emptyText}</p>
  const rest = state.data.length - LIST_PREVIEW_COUNT
  return (
    <>
      <div className="dashboard-stock-row dashboard-stock-heading"><span>品名</span><span>{valueLabel}</span></div>
      <ul className="dashboard-list dashboard-stock-list" aria-label={label}>{state.data.slice(0, LIST_PREVIEW_COUNT).map(render)}</ul>
      {rest > 0 && <p className="dashboard-list-more">ほか{rest}件</p>}
    </>
  )
}

// カードの枠(#493)。見出しの行にタイトル・ボタン風のリンク・開閉ボタンを並べ、本文は閉じている間隠す。
function SummaryCard({ id, title, className, action, collapsed, onToggle, children }: { id: OrderableCard; title: string; className?: string; action?: ReactNode; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyId = 'dashboard-card-body-' + id
  return (
    <div className={'card dashboard-card' + (className ? ' ' + className : '') + (collapsed ? ' is-collapsed' : '')}>
      <div className="dashboard-card-head">
        <h2>{title}</h2>
        {action}
        <button type="button" className="dashboard-card-toggle" aria-label={title + 'の開閉'} aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
          <span className="dashboard-card-chevron" aria-hidden="true" />
        </button>
      </div>
      <div id={bodyId} className="dashboard-card-body" hidden={collapsed}>{children}</div>
    </div>
  )
}

// ボタン風のリンク。表示は短くし、読み上げ用の名前は従来の「…を見る」のままにする。
function CardLink({ to, name, children }: { to: string; name: string; children: ReactNode }) {
  return <Link to={to} className="dashboard-card-link" aria-label={name}>{children}<span aria-hidden="true">›</span></Link>
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
  // 開閉の記憶は利用者ごとに分ける。認証の情報が無い(利用者が分からない)ときは記憶しない。
  const auth = useContext(AuthContext)
  const userId = auth?.userStatus === 'ready' ? auth.user?.id ?? null : null
  const [collapsedState, setCollapsedState] = useState(() => ({ userId, cards: readCollapsedCards(userId) }))
  let collapsedCards = collapsedState.cards
  if (collapsedState.userId !== userId) {
    // 利用者が変わった(確定した)ら、その利用者の記憶に切り替える。
    collapsedCards = readCollapsedCards(userId)
    setCollapsedState({ userId, cards: collapsedCards })
  }
  const toggleCard = (card: OrderableCard) => {
    const next = collapsedCards.includes(card) ? collapsedCards.filter((entry) => entry !== card) : [...collapsedCards, card]
    setCollapsedState({ userId, cards: next })
    writeCollapsedCards(userId, next)
  }
  const frame = (card: OrderableCard) => ({ id: card, collapsed: collapsedCards.includes(card), onToggle: () => toggleCard(card) })
  const [summary, setSummary] = useState<Loadable<DashboardSummary>>({ status: 'loading' })
  const [eventSummaryPeriod, setEventSummaryPeriod] = useState<EventSummaryPeriod>('year')
  const [eventSummaries, setEventSummaries] = useState<Loadable<DashboardSummary['eventExpenseSummaries']>>({ status: 'loading' })
  const [shoppingList, setShoppingList] = useState<Loadable<ShoppingListItem[]>>({ status: 'loading' })
  const [inventory, setInventory] = useState<Loadable<InventoryItem[]>>({ status: 'loading' })
  const [accountBalanceTotal, setAccountBalanceTotal] = useState<Loadable<number>>({ status: 'loading' })
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const dayTrigger = useRef<HTMLElement | null>(null)
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings | null>(null)
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
  const openToday = (trigger: HTMLButtonElement) => {
    dayTrigger.current = trigger
    setSelectedDay({ date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()), events: [], fixedCosts: [], income: 0, expense: 0, balance: 0 })
  }

  const cardContents: Record<OrderableCard, ReactNode> = {
    today: (
      <SummaryCard key="today" {...frame('today')} title="今日の状況" className="dashboard-today-card">
        {summaryData ? (
          <>
            {items?.today.menu !== false && <button type="button" className="dashboard-today-row" onClick={event => openToday(event.currentTarget)}><span>今週の献立</span>{' '}<span className="dashboard-today-count">{summaryData.weeklyMenuEntries.length}件</span></button>}
            {items?.today.events !== false && <button type="button" className="dashboard-today-row" onClick={event => openToday(event.currentTarget)}><span>イベント</span>{' '}<span className="dashboard-today-count">{summaryData.todayEvents.length}件</span></button>}
          </>
        ) : summaryFallback}
      </SummaryCard>
    ),
    stock: (
      <SummaryCard key="stock" {...frame('stock')} title="買い物・在庫">
        {items?.stock.shoppingList !== false && (
          <>
            <div className="dashboard-sub-head"><h3>買い物リスト</h3><CardLink to="/zaiko/shopping" name="買い物リストを見る">買い物リスト</CardLink></div>
            <PreviewList
              label="買い物リスト"
              state={shoppingList}
              emptyText="買い物リストは空です"
              valueLabel="値段"
              render={(item) => <li className="dashboard-stock-row" key={item.id}><span className="dashboard-stock-name">{item.name}</span><span className="dashboard-stock-value">{formatPrice(item.price)}</span></li>}
            />
          </>
        )}
        {items?.stock.inventoryList !== false && (
          <>
            <div className="dashboard-sub-head"><h3>在庫リスト</h3><CardLink to="/zaiko" name="在庫一覧を見る">在庫一覧</CardLink></div>
            <PreviewList
              label="在庫リスト"
              state={inventory}
              emptyText="在庫は登録されていません"
              valueLabel="残数"
              render={(item) => (
                <li className="dashboard-stock-row" key={item.id}>
                  <span className="dashboard-stock-name">{item.name}</span>
                  <span className="dashboard-stock-value">残{item.quantity}
                  {item.quantity <= item.threshold && <span className="dashboard-low-stock">（不足）</span>}
                  </span>
                </li>
              )}
            />
          </>
        )}
      </SummaryCard>
    ),
    finance: (
      <SummaryCard key="finance" {...frame('finance')} title="個人の財政" action={<CardLink to="/accounts" name="口座・カード管理を見る">口座・カード管理</CardLink>}>
        <p>
          口座残高合計:{' '}
          {accountBalanceTotal.status === 'ok' ? `${accountBalanceTotal.data}円` : accountBalanceTotal.status === 'loading' ? '読み込み中...' : '取得できませんでした'}
        </p>
      </SummaryCard>
    ),
    money: (
      <SummaryCard key="money" {...frame('money')} title="今月のお金" action={<CardLink to="/warikan" name="精算一覧を見る">精算一覧</CardLink>}>
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
      </SummaryCard>
    ),
    eventExpenses: (
      <SummaryCard key="eventExpenses" {...frame('eventExpenses')} title="イベント別支出" action={<CardLink to="/events" name="イベント一覧を見る">イベント一覧</CardLink>}>
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
      </SummaryCard>
    ),
  }

  const visibleCards = cardOrder.filter(card => showCard(card) && (card !== 'today' || items?.today.menu !== false || items?.today.events !== false))

  return (
    <div className="page dashboard-home">
      <div className="dashboard-layout">
        {showCard('calendar') && (
          <CalendarPanel
            onSelectDate={(day) => {
              dayTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
              setSelectedDay(day)
            }}
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
      {selectedDay && <DayDetailModal day={selectedDay} onClose={() => { setSelectedDay(null); dayTrigger.current?.focus({ preventScroll: true }) }} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
