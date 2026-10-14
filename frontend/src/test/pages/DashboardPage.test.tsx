import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { DashboardPage } from '../../pages/DashboardPage'
import type { InventoryItem, ShoppingListItem } from '../../api/zaikoTypes'
import type { DisplaySettings } from '../../api/userSettingsTypes'
import type { CalendarDay } from '../../components/dashboard/CalendarPanel'

function setupApi(options: {
  summary?: {
    shoppingListCount: number
    lowStockCount: number
    householdExpenseTotal: number
    todayBalance?: number
    weeklyMenuEntries?: { recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null }[]
    todayEvents?: { name: string; recurrenceType: string }[]
    monthlyPersonalExpense?: number
    unsettledReceivable?: { count: number; total: number }
    unsettledPayable?: { count: number; total: number }
    eventExpenseSummaries?: { eventId: number; name: string; total: number }[]
  }
  inventory?: InventoryItem[]
  shoppingList?: ShoppingListItem[]
  shoppingListError?: boolean
  eventSummariesByPeriod?: Record<string, { eventId: number; name: string; total: number }[]>
  eventSummaryError?: boolean
  accounts?: {
    id: number
    name: string
    type: string
    balance: number
    cards: { id: number; name: string; accountId: number; cardType: string; balance: number }[]
  }[]
  summaryError?: boolean
  accountsError?: boolean
  summaryRequestUrls?: string[]
  settings?: DisplaySettings
  calendar?: {
    days: CalendarDay[]
  }
} = {}) {
  server.use(
    http.get('/api/dashboard/summary', ({ request }) => {
      options.summaryRequestUrls?.push(request.url)
      const period = new URL(request.url).searchParams.get('eventPeriod')
      if (options.summaryError || (period && options.eventSummaryError)) {
        return HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'サマリーの取得に失敗しました' }, { status: 500 })
      }
      return HttpResponse.json({
        shoppingListCount: 0,
        lowStockCount: 0,
        householdExpenseTotal: 0,
        todayBalance: 0,
        weeklyMenuEntries: [],
        todayEvents: [],
        monthlyPersonalExpense: 0,
        unsettledReceivable: { count: 0, total: 0 },
        unsettledPayable: { count: 0, total: 0 },
        eventExpenseSummaries: [],
        ...options.summary,
        ...(period && options.eventSummariesByPeriod ? { eventExpenseSummaries: options.eventSummariesByPeriod[period] } : {}),
      })
    }),
    http.get('/api/user-settings', () => (options.settings ? HttpResponse.json(options.settings) : HttpResponse.json({ message: 'not found' }, { status: 404 }))),
    http.get('/api/inventory-items', () => HttpResponse.json(options.inventory ?? [])),
    http.get('/api/shopping-list-items', () =>
      options.shoppingListError ? HttpResponse.json({ message: '失敗' }, { status: 500 }) : HttpResponse.json(options.shoppingList ?? []),
    ),
    http.get('/api/dashboard/calendar', () => HttpResponse.json(options.calendar ?? { days: [] })),
    http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount: 0 })),
    http.get('/api/accounts', () => {
      if (options.accountsError) {
        return HttpResponse.json({ code: 'INTERNAL_ERROR', message: '口座情報の取得に失敗しました' }, { status: 500 })
      }
      return HttpResponse.json(options.accounts ?? [])
    }),
  )
}

function renderDashboardPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <DashboardPage />
    </MemoryRouter>,
  )
}

const inventory: InventoryItem[] = [
  { id: 1, name: '卵', categoryId: 5, storeId: null, quantity: 2, threshold: 1 },
  { id: 2, name: '牛乳', categoryId: 4, storeId: null, quantity: 1, threshold: 0.5 },
  { id: 3, name: '醤油', categoryId: 6, storeId: null, quantity: 0.5, threshold: 1 },
  { id: 4, name: '味噌', categoryId: 6, storeId: null, quantity: 3, threshold: 1 },
]

const shoppingList: ShoppingListItem[] = [
  { id: 1, inventoryItemId: 3, name: '醤油', isManual: false, purchased: false, purchasedQuantity: 0 },
  { id: 2, inventoryItemId: 9, name: '購入済みの品', isManual: true, purchased: true, purchasedQuantity: 1 },
  { id: 3, inventoryItemId: 10, name: 'トイレットペーパー', isManual: true, purchased: false, purchasedQuantity: 0 },
]

describe('DashboardPage', () => {
  function setupMenu() {
    setupApi({ summary: { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 0,
      weeklyMenuEntries: [
        { recipeId: 2, recipeTitle: '[E2E_TEST] 同名', freeTextMemo: null },
        { recipeId: null, recipeTitle: null, freeTextMemo: '[E2E_TEST] 外食' },
        { recipeId: 3, recipeTitle: null, freeTextMemo: null },
      ],
    } })
  }

  it('献立のIDで同名レシピを選び閲覧専用で開き、閉じるとフォーカスを戻す', async () => {
    setupMenu()
    server.use(http.get('/api/recipes', () => HttpResponse.json([1, 2].map((id) => ({
      id, title: '[E2E_TEST] 同名', ingredients: `材料${id}`, steps: `手順${id}`,
      sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false,
    })))))
    renderDashboardPage()
    const button = await screen.findByRole('button', { name: '[E2E_TEST] 同名' })
    const list = screen.getByRole('list', { name: '今週の献立' })
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    expect(within(list).getByText('削除されたレシピ')).toBeInTheDocument()
    for (const close of ['button', 'escape', 'overlay']) {
      fireEvent.click(button)
      const dialog = await screen.findByRole('dialog', { name: 'レシピ詳細' })
      expect(within(dialog).getByText('材料2')).toBeInTheDocument()
      expect(within(dialog).getByText('手順2')).toBeInTheDocument()
      expect(within(dialog).queryByText('材料1')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
      fireEvent.click(within(dialog).getByText('材料2'))
      expect(dialog).toBeInTheDocument()
      if (close === 'button') fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
      else if (close === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
      else fireEvent.click(dialog)
      expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
      expect(button).toHaveFocus()
    }
  })

  it.each(['error', 'missing'])('取得%sでは詳細を開かず通知し再試行できる', async (state) => {
    setupMenu()
    server.use(http.get('/api/recipes', () => state === 'error'
      ? HttpResponse.json({ message: 'レシピ取得失敗' }, { status: 500 }) : HttpResponse.json([])))
    renderDashboardPage()
    const button = await screen.findByRole('button', { name: '[E2E_TEST] 同名' })
    fireEvent.click(button)
    expect(await screen.findByText(state === 'error' ? 'レシピ取得失敗' : 'レシピが見つかりませんでした')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
    expect(button).toBeEnabled()
  })

  it.each(['ocr', 'web'])('献立の%sレシピも既存詳細表示を再利用する', async (sourceType) => {
    setupMenu()
    server.use(http.get('/api/recipes', () => HttpResponse.json([{
      id: 2, title: '[E2E_TEST] 同名', sourceType, ingredients: '[E2E_TEST] 材料', steps: '[E2E_TEST] 手順',
      url: 'https://recipe.example.com/test', thumbnailUrl: null, memo: '[E2E_TEST] メモ', isFavorite: false,
    }])))
    renderDashboardPage()
    fireEvent.click(await screen.findByRole('button', { name: '[E2E_TEST] 同名' }))
    const dialog = await screen.findByRole('dialog', { name: 'レシピ詳細' })
    if (sourceType === 'web') {
      expect(within(dialog).getByRole('link', { name: '元ページを開く' })).toHaveAttribute('href', 'https://recipe.example.com/test')
      expect(within(dialog).getByText('[E2E_TEST] メモ')).toBeInTheDocument()
      expect(within(dialog).queryByRole('list', { name: '材料' })).not.toBeInTheDocument()
    } else {
      expect(within(dialog).getByText('画像解析')).toBeInTheDocument()
      expect(within(dialog).getByText('[E2E_TEST] 材料')).toBeInTheDocument()
      expect(within(dialog).getByText('[E2E_TEST] 手順')).toBeInTheDocument()
    }
  })

  it('読み込み中は多重取得を防ぎ、離脱後の応答を破棄する', async () => {
    setupMenu()
    let requests = 0
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.get('/api/recipes', async () => {
      requests++
      await pending
      return HttpResponse.json([])
    }))
    const view = renderDashboardPage()
    const button = await screen.findByRole('button', { name: '[E2E_TEST] 同名' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(requests).toBe(1))
    expect(button).toBeDisabled()
    view.unmount()
    release()
    await delay(10)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    { state: '口座あり', accounts: [{ id: 1, name: '[E2E_TEST] 口座', type: 'bank', balance: 13000, cards: [] }], balance: '13000円' },
    { state: '口座なし', accounts: [], balance: '0円' },
    { state: '取得失敗', accountsError: true, balance: '取得できませんでした' },
  ])('$stateでも残高段落の直後に管理リンクを表示する', async ({ balance, ...options }) => {
    setupApi(options)
    renderDashboardPage()
    const paragraph = await screen.findByText('口座残高合計: ' + balance)
    const card = paragraph.closest('.card')!
    const links = within(card as HTMLElement).getAllByRole('link', { name: '口座・カード管理を見る' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/accounts')
    expect(paragraph).not.toContainElement(links[0])
    expect(paragraph.nextElementSibling).toBe(links[0])
  })

  it('読み込み中も残高段落の直後に管理リンクを表示する', async () => {
    setupApi()
    server.use(http.get('/api/accounts', async () => {
      await delay(200)
      return HttpResponse.json([])
    }))
    renderDashboardPage()
    const paragraph = screen.getByText('口座残高合計: 読み込み中...')
    const link = screen.getByRole('link', { name: '口座・カード管理を見る' })
    expect(paragraph).not.toContainElement(link)
    expect(paragraph.nextElementSibling).toBe(link)
    expect(link).toHaveAttribute('href', '/accounts')
    await screen.findByText('口座残高合計: 0円')
  })

  it('買い物リスト（未購入のみ）と在庫の残数・不足を非リンクで表示する', async () => {
    setupApi({ inventory, shoppingList })
    renderDashboardPage()

    const shopping = await screen.findByRole('list', { name: '買い物リスト' })
    expect(within(shopping).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['醤油未設定', 'トイレットペーパー未設定'])
    const stock = await screen.findByRole('list', { name: '在庫リスト' })
    expect(within(stock).getAllByRole('listitem')).toHaveLength(4)
    expect(within(stock).getByText('卵').closest('li')).toHaveTextContent('残2')
    expect(within(stock).getByText('醤油').closest('li')).toHaveTextContent('残0.5')
    expect(within(screen.getByRole('heading', { name: '買い物・在庫' }).parentElement!).queryAllByRole('link')).toHaveLength(0)
    expect(within(stock).getByText('醤油').closest('li')).toHaveTextContent('（不足）')
    expect(within(stock).getByText('卵').closest('li')).not.toHaveTextContent('（不足）')
    expect(screen.queryByText(/よく使う品目/)).not.toBeInTheDocument()
    expect(screen.queryByText(/在庫不足:/)).not.toBeInTheDocument()
  })

  it('同名の別IDも各行の参考値段を表示し、購入済みを除外する', async () => {
    const prices = [1280, 0, null, undefined, 9999999999]
    setupApi({ shoppingList: prices.map((price, index) => ({ id: index + 1, inventoryItemId: index + 1, name: '[E2E_TEST] 同名', price, isManual: true, purchased: false, purchasedQuantity: 3 })).concat([{ id: 6, inventoryItemId: 6, name: '[E2E_TEST] 購入済み', price: 100, isManual: true, purchased: true, purchasedQuantity: 1 }]) })
    renderDashboardPage()
    const list = await screen.findByRole('list', { name: '買い物リスト' })
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['[E2E_TEST] 同名1,280円', '[E2E_TEST] 同名0円', '[E2E_TEST] 同名未設定', '[E2E_TEST] 同名未設定', '[E2E_TEST] 同名9,999,999,999円'])
    expect(screen.queryByText('[E2E_TEST] 購入済み')).not.toBeInTheDocument()
    expect(screen.getByText('値段')).toBeInTheDocument()
  })

  it('在庫は参考値段を表示せず、残数と閾値未満だけ不足を表示する', async () => {
    setupApi({ inventory: [0, 0.5, 2].map((quantity, index) => ({ id: index + 1, name: `[E2E_TEST] 在庫${index}`, quantity, threshold: 0.5, categoryId: 1, storeId: null, price: 1280 })) })
    renderDashboardPage()
    const list = await screen.findByRole('list', { name: '在庫リスト' })
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['[E2E_TEST] 在庫0残0（不足）', '[E2E_TEST] 在庫1残0.5', '[E2E_TEST] 在庫2残2'])
    expect(within(list).queryByText('1,280円')).not.toBeInTheDocument()
    expect(screen.getByText('残数')).toBeInTheDocument()
  })

  it.each(['loading', 'empty', 'error'] as const)('%sでも買い物・在庫カードにはリンクがない', async (state) => {
    setupApi({ shoppingListError: state === 'error' })
    if (state === 'loading') server.use(http.get('/api/shopping-list-items', async () => { await delay(100); return HttpResponse.json([]) }))
    renderDashboardPage()
    if (state === 'error') await screen.findByText('買い物リストを取得できませんでした')
    if (state === 'empty') await screen.findByText('買い物リストは空です')
    const card = screen.getByRole('heading', { name: '買い物・在庫' }).parentElement!
    expect(within(card).queryAllByRole('link')).toHaveLength(0)
    if (state === 'loading') await screen.findByText('買い物リストは空です')
  })

  it('長い品名の全文を保持する', async () => {
    const name = '[E2E_TEST]' + '長'.repeat(41)
    setupApi({ inventory: [{ id: 1, name, quantity: 2, threshold: 1, categoryId: 1, storeId: null }] })
    renderDashboardPage()
    expect(within(await screen.findByRole('list', { name: '在庫リスト' })).getByText(name)).toHaveTextContent(name)
  })

  it('買い物リスト・在庫が空のときは空である旨を表示し、多い場合は先頭8件と残件数を表示する', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, inventoryItemId: index + 1, name: `品目${index + 1}`, isManual: true, purchased: false, purchasedQuantity: 0 }))
    setupApi({ inventory: [], shoppingList: many })
    renderDashboardPage()

    const shopping = await screen.findByRole('list', { name: '買い物リスト' })
    expect(within(shopping).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByText('ほか2件')).toBeInTheDocument()
    expect(screen.getByText('在庫は登録されていません')).toBeInTheDocument()
  })

  it('買い物リストの取得に失敗したらカード内にエラーを表示し、在庫リストは表示する', async () => {
    setupApi({ inventory, shoppingListError: true })
    renderDashboardPage()

    expect(await screen.findByText('買い物リストを取得できませんでした')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '在庫リスト' })).toBeInTheDocument()
  })

  it('API失敗時はトーストでエラーを表示する', async () => {
    setupApi({ summaryError: true })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('サマリーの取得に失敗しました')).toBeInTheDocument())
  })

  it('複数のAPIが同時に失敗した場合はすべてのエラーをトーストに表示する', async () => {
    setupApi({ summaryError: true, accountsError: true })
    renderDashboardPage()

    await waitFor(() => {
      expect(
        screen.getByText('サマリーの取得に失敗しました、口座情報の取得に失敗しました'),
      ).toBeInTheDocument()
    })
  })

  it('口座情報だけ失敗してもサマリーと在庫情報を表示する', async () => {
    setupApi({
      summary: { shoppingListCount: 3, lowStockCount: 2, householdExpenseTotal: 0 },
      inventory,
      accountsError: true,
    })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('口座情報の取得に失敗しました')).toBeInTheDocument())
    expect(screen.getByText(/口座残高合計: 取得できませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '在庫リスト' })).toBeInTheDocument()
  })

  it('「個人の財政」カードに自分の口座残高合計を表示する', async () => {
    setupApi({
      accounts: [
        { id: 1, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] },
        { id: 2, name: 'PayPay', type: 'e_money', balance: 3000, cards: [] },
      ],
    })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('個人の財政')).toBeInTheDocument())
    expect(screen.getByText(/口座残高合計: 13000円/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '口座・カード管理を見る' })).toHaveAttribute('href', '/accounts')
  })

  it('「今月のお金」カードに世帯合計対象額を表示する', async () => {
    setupApi({ summary: { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 45000 } })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('今月のお金')).toBeInTheDocument())
    expect(screen.getByText(/世帯合計対象額: 45000円/)).toBeInTheDocument()
  })

  it('チャージ型カードの残高も口座残高合計に含める', async () => {
    setupApi({
      accounts: [
        {
          id: 1,
          name: '〇〇銀行',
          type: 'bank',
          balance: 7000,
          cards: [
            { id: 10, name: 'Suica', accountId: 1, cardType: 'charge', balance: 3000 },
            { id: 11, name: 'クレカ', accountId: 1, cardType: 'credit', balance: 0 },
          ],
        },
      ],
    })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText(/口座残高合計: 10000円/)).toBeInTheDocument())
  })

  it('今日の状況と今月のお金の集計値・導線を表示する', async () => {
    setupApi({
      summary: {
        shoppingListCount: 0,
        lowStockCount: 0,
        householdExpenseTotal: 45300,
        todayBalance: -500,
        weeklyMenuEntries: [
          { recipeId: 1, recipeTitle: 'カレー', freeTextMemo: null },
          { recipeId: null, recipeTitle: null, freeTextMemo: '外食' },
        ],
        todayEvents: [{ name: '学習', recurrenceType: 'daily' }],
        monthlyPersonalExpense: 32000,
        unsettledReceivable: { count: 1, total: 4000 },
        unsettledPayable: { count: 1, total: 4500 },
        eventExpenseSummaries: [{ eventId: 1, name: '旅行', total: 30000 }],
      },
    })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('今日の状況')).toBeInTheDocument())
    expect(screen.getByText(/収支: -500円/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '今週の献立' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['カレー', '外食'])
    expect(screen.getByText(/イベント: 学習/)).toBeInTheDocument()
    expect(screen.getByText(/個人支出: 32000円/)).toBeInTheDocument()
    expect(screen.getByText(/世帯合計対象額: 45300円/)).toBeInTheDocument()
    expect(screen.getByText(/受取予定: 1件・4000円/)).toBeInTheDocument()
    expect(screen.getByText(/支払予定: 1件・4500円/)).toBeInTheDocument()
    expect(await screen.findByText(/旅行: 30000円/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '精算一覧を見る' })).toHaveAttribute('href', '/warikan')
    expect(screen.getByRole('link', { name: 'イベント一覧を見る' })).toHaveAttribute('href', '/events')
  })

  it('今日の状況とイベント別支出は0件でも「なし」を表示する', async () => {
    setupApi({ summary: { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 0 } })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('今日の状況')).toBeInTheDocument())
    expect(screen.getByText(/今週の献立: なし/)).toBeInTheDocument()
    expect(screen.getByText(/イベント: なし/)).toBeInTheDocument()
    expect(await screen.findByText('イベント別支出: なし')).toBeInTheDocument()
  })

  it('イベント別支出は今日・今月・今年を切り替えて、その期間の集計を表示する', async () => {
    const summaryRequestUrls: string[] = []
    setupApi({ summaryRequestUrls, eventSummariesByPeriod: { year: [{ eventId: 1, name: '旅行', total: 30000 }], month: [{ eventId: 1, name: '旅行', total: 5000 }], today: [] } })
    renderDashboardPage()

    const periodSelect = await screen.findByLabelText('イベント別支出（対象期間）')
    expect(periodSelect).toHaveValue('year')
    expect(within(periodSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['今日', '今月', '今年'])
    expect(await screen.findByText('旅行: 30000円')).toBeInTheDocument()
    fireEvent.change(periodSelect, { target: { value: 'month' } })
    expect(await screen.findByText('旅行: 5000円')).toBeInTheDocument()
    fireEvent.change(periodSelect, { target: { value: 'today' } })
    expect(await screen.findByText('イベント別支出: なし')).toBeInTheDocument()
    expect(summaryRequestUrls.some((url) => url.endsWith('eventPeriod=today'))).toBe(true)
  })

  it('イベント別支出の取得に失敗したらカード内にエラーを表示する', async () => {
    setupApi({ eventSummaryError: true })
    renderDashboardPage()
    expect(await screen.findByText('イベント別支出を取得できませんでした')).toBeInTheDocument()
  })

  it('全カードとカレンダーを非表示にした場合は表示設定への案内を表示する', async () => {
    setupApi({
      settings: {
        cards: { today: false, stock: false, finance: false, money: false, eventExpenses: false, calendar: false },
        cardOrder: ['today', 'stock', 'finance', 'money', 'eventExpenses'],
        items: {
          today: { balance: true, menu: true, events: true },
          stock: { shoppingList: true, inventoryList: true },
          money: { personal: true, householdTotal: true, unsettled: true },
          calendar: { income: true, expense: true, events: true },
        },
      },
    })
    renderDashboardPage()
    expect(await screen.findByRole('link', { name: '表示設定を開く' })).toHaveAttribute('href', '/settings/display')
  })

  it('月間カレンダーにイベント・固定費・日次支出を表示する', async () => {
    setupApi({
      summary: { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 0 },
      calendar: {
        days: [{ date: '2026-09-25', fixedCosts: ['家賃'], events: [{ id: 1, name: '通院', isRecurring: true, recurrenceType: 'weekly', eventDate: '2026-09-04' }], income: 0, expense: 1200, balance: -1200 }],
      },
    })
    renderDashboardPage()

    expect(await screen.findByRole('heading', { name: '月間カレンダー' })).toBeInTheDocument()
    expect(screen.queryByText(/通知: \d+件/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/通院/)).toBeInTheDocument()
      expect(screen.getByText(/家賃/)).toBeInTheDocument()
      expect(screen.getByText(/-1200円/)).toBeInTheDocument()
    })
  })

  it('月間カレンダーをサマリーカード群より先に配置する', async () => {
    setupApi()
    const { container } = renderDashboardPage()

    const calendarHeading = await screen.findByRole('heading', { name: '月間カレンダー' })
    const layout = container.querySelector('.dashboard-layout')
    const summaryCards = container.querySelector('.dashboard-summary-grid')

    expect(layout).toBeInTheDocument()
    expect(summaryCards).toBeInTheDocument()
    expect(layout?.firstElementChild).toContainElement(calendarHeading)
    expect(layout?.lastElementChild).toBe(summaryCards)
  })

  describe('表示設定の反映', () => {
    function settings(): DisplaySettings {
      return {
        cards: { today: true, stock: true, finance: true, money: true, eventExpenses: true, calendar: true },
        cardOrder: ['today', 'stock', 'finance', 'money', 'eventExpenses'],
        items: {
          today: { balance: true, menu: true, events: true },
          stock: { shoppingList: true, inventoryList: true },
          money: { personal: true, householdTotal: true, unsettled: true },
          calendar: { income: true, expense: true, events: true },
        },
      }
    }

    async function cardHeadings(container: HTMLElement) {
      await screen.findByRole('heading', { name: '月間カレンダー' })
      return Array.from(container.querySelectorAll('.dashboard-summary-grid > .card > h2')).map((h) => h.textContent)
    }

    it('保存済みのカード順でカードを並べ、イベント別支出を独立したカードとして表示する', async () => {
      const value = settings()
      value.cardOrder = ['eventExpenses', 'money', 'finance', 'stock', 'today']
      setupApi({ settings: value })
      const { container } = renderDashboardPage()
      await waitFor(async () => expect(await cardHeadings(container)).toEqual(['イベント別支出', '今月のお金', '個人の財政', '買い物・在庫', '今日の状況']))
    })

    it('表示OFFのカード・項目とカレンダーを表示しない', async () => {
      const value = settings()
      value.cards.finance = false
      value.cards.eventExpenses = false
      value.items.stock.inventoryList = false
      value.items.money.householdTotal = false
      value.items.today.menu = false
      setupApi({ settings: value, inventory, shoppingList })
      const { container } = renderDashboardPage()
      await waitFor(async () => expect(await cardHeadings(container)).toEqual(['今日の状況', '買い物・在庫', '今月のお金']))
      expect(await screen.findByRole('list', { name: '買い物リスト' })).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: '在庫リスト' })).not.toBeInTheDocument()
      expect(screen.queryByText(/今週の献立/)).not.toBeInTheDocument()
      expect(screen.queryByText(/世帯合計対象額/)).not.toBeInTheDocument()
      expect(screen.queryByLabelText('イベント別支出（対象期間）')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '口座・カード管理を見る' })).not.toBeInTheDocument()
    })

    it('カレンダーが表示OFFなら月間カレンダーを表示しない', async () => {
      const value = settings()
      value.cards.calendar = false
      setupApi({ settings: value })
      renderDashboardPage()
      expect(await screen.findByRole('heading', { name: '今日の状況' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: '月間カレンダー' })).not.toBeInTheDocument()
    })
  })
})
