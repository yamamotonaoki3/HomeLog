import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { KakeiboPage } from '../../pages/KakeiboPage'
import type { Event } from '../../api/eventTypes'
import type { Account, Expense, FixedCost, Income } from '../../api/kakeiboTypes'

const defaultCategories = [
  { id: 1, name: '食費', isDefault: true },
  { id: 2, name: '日用品', isDefault: true },
]

const defaultIncomeCategories = [
  { id: 11, name: '給与', isDefault: true },
  { id: 12, name: 'ボーナス', isDefault: true },
]

interface MockState {
  expenses: Expense[]
  incomes: Income[]
  accounts: Account[]
  fixedCosts: FixedCost[]
  events: Event[]
  members?: { userId: number; displayName: string }[]
  splits?: import('../../api/warikanTypes').ExpenseSplit[]
  dashboardSummary?: { shoppingListCount: number; lowStockCount: number; householdExpenseTotal: number }
  // イベントID => {year: 今年の集計, month: 今月の集計}。エントリが無いイベントは
  // (show_on_dashboard=falseと同じ)404を返す=集計対象外として扱われる。
  eventSummaries?: Record<number, { year: number; month: number }>
}

/** 家計簿API一式を状態ベースでモックし、リクエスト記録と状態を返す */
function setupApi(initial: Partial<MockState> = {}) {
  const state: MockState = {
    expenses: initial.expenses ?? [],
    incomes: initial.incomes ?? [],
    accounts: initial.accounts ?? [],
    fixedCosts: initial.fixedCosts ?? [],
    events: initial.events ?? [],
  }
  const calls: { method: string; url: string; body?: unknown }[] = []

  server.use(
    http.get('/api/kakeibo-categories', () => HttpResponse.json(defaultCategories)),
    http.get('/api/expenses', ({ request }) => {
      calls.push({ method: 'GET', url: new URL(request.url).pathname + new URL(request.url).search })
      const categoryId = new URL(request.url).searchParams.get('categoryId')
      const filtered = categoryId
        ? state.expenses.filter((e) => e.categoryId === Number(categoryId))
        : state.expenses
      return HttpResponse.json(filtered)
    }),
    http.post('/api/expenses', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/expenses', body })
      const expense: Expense = {
        id: 100,
        expenseDate: body.expenseDate as string,
        amount: body.amount as number,
        purpose: body.purpose as string,
        categoryId: body.categoryId as number,
        memo: (body.memo as string | null) ?? null,
        includeInHouseholdTotal: Boolean(body.includeInHouseholdTotal),
        accountId: (body.accountId as number | null) ?? (body.cardId ? 5 : null),
        cardId: (body.cardId as number | null) ?? null,
        eventId: (body.eventId as number | null) ?? null,
      }
      state.expenses.push(expense)
      return HttpResponse.json(expense, { status: 201 })
    }),
    http.get('/api/income-categories', () => HttpResponse.json(defaultIncomeCategories)),
    http.get('/api/incomes', ({ request }) => {
      calls.push({ method: 'GET', url: new URL(request.url).pathname + new URL(request.url).search })
      const categoryId = new URL(request.url).searchParams.get('categoryId')
      const filtered = categoryId
        ? state.incomes.filter((i) => i.categoryId === Number(categoryId))
        : state.incomes
      return HttpResponse.json(filtered)
    }),
    http.post('/api/incomes', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/incomes', body })
      const income: Income = {
        id: 200,
        incomeDate: body.incomeDate as string,
        amount: body.amount as number,
        content: body.content as string,
        categoryId: body.categoryId as number,
        memo: (body.memo as string | null) ?? null,
      }
      state.incomes.push(income)
      return HttpResponse.json(income, { status: 201 })
    }),
    http.get('/api/accounts', () => HttpResponse.json(state.accounts)),
    http.get('/api/fixed-costs', () => HttpResponse.json(state.fixedCosts)),
    http.get('/api/events', () => HttpResponse.json(state.events)),
    http.get('/api/households/me', () => HttpResponse.json({ members: initial.members ?? [] })),
    http.get('/api/expense-splits', () => HttpResponse.json(initial.splits ?? [])),
    http.get('/api/dashboard/summary', () =>
      HttpResponse.json(initial.dashboardSummary ?? { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 0 }),
    ),
    http.get('/api/events/:id/summary', ({ request, params }) => {
      const period = new URL(request.url).searchParams.get('period') as 'year' | 'month'
      calls.push({ method: 'GET', url: `/api/events/${params.id}/summary?period=${period}` })
      const entry = initial.eventSummaries?.[Number(params.id)]
      if (entry === undefined) {
        return HttpResponse.json({ code: 'RESOURCE_NOT_FOUND', message: '集計対象外のイベントです' }, { status: 404 })
      }
      return HttpResponse.json({ total: entry[period] })
    }),
  )

  return { state, calls }
}

function renderKakeiboPage() {
  return render(
    <MemoryRouter initialEntries={['/kakeibo']}>
      <KakeiboPage />
    </MemoryRouter>,
  )
}

const lunchExpense: Expense = {
  id: 1,
  expenseDate: '2026-01-01',
  amount: 1200,
  purpose: 'ランチ',
  categoryId: 1,
  memo: null,
  includeInHouseholdTotal: false,
  accountId: null,
  cardId: null,
  eventId: null,
}
const suppliesExpense: Expense = {
  id: 2,
  expenseDate: '2026-01-02',
  amount: 800,
  purpose: '洗剤',
  categoryId: 2,
  memo: null,
  includeInHouseholdTotal: true,
  accountId: null,
  cardId: null,
  eventId: null,
}

const salaryIncome: Income = {
  id: 1,
  incomeDate: '2026-01-25',
  amount: 300000,
  content: '1月分給与',
  categoryId: 11,
  memo: null,
}
const bonusIncome: Income = {
  id: 2,
  incomeDate: '2026-06-10',
  amount: 500000,
  content: '夏季賞与',
  categoryId: 12,
  memo: null,
}

async function openModal() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '登録' }))
  return user
}

describe('KakeiboPage 未精算サマリー', () => {
  it('未精算の割り勘の件数・金額を支払う/受け取るで表示する', async () => {
    setupApi({
      splits: [
        {
          id: 1, expenseId: 1, expensePurpose: 'A', expenseAmount: 2000, expenseDate: '2026-01-01',
          role: 'debtor', isExternal: false, payerLabel: 'テスト太郎', debtorLabel: 'テスト花子',
          splitInputType: 'ratio', splitRatio: 50, amountDue: 1000, status: 'requested',
          debtorAccountId: null, requestedAt: null, settledAt: null, commentCount: 0,
        },
        {
          id: 2, expenseId: 2, expensePurpose: 'B', expenseAmount: 600, expenseDate: '2026-01-02',
          role: 'payer', isExternal: false, payerLabel: 'テスト太郎', debtorLabel: 'テスト花子',
          splitInputType: 'ratio', splitRatio: 50, amountDue: 300, status: 'unpaid',
          debtorAccountId: null, requestedAt: null, settledAt: null, commentCount: 0,
        },
      ],
    })
    renderKakeiboPage()

    const summary = await screen.findByTestId('warikan-summary')
    expect(summary).toHaveTextContent('支払う 1件 1000円')
    expect(summary).toHaveTextContent('受け取る 1件 300円')
  })
})

describe('KakeiboPage', () => {
  it('支出・収入が一つの一覧に混在し日時降順で表示される', async () => {
    setupApi({ expenses: [lunchExpense], incomes: [salaryIncome] })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('1月分給与')
    expect(rows[0]).toHaveTextContent('収入')
    expect(rows[1]).toHaveTextContent('ランチ')
    expect(rows[1]).toHaveTextContent('支出')
  })

  it('収支の記録が0件のときプレースホルダーを表示する', async () => {
    setupApi()
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
  })

  it('種別を支出に切り替えるとカテゴリー絞り込みが表示され支出のみ表示される', async () => {
    setupApi({ expenses: [lunchExpense], incomes: [salaryIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    expect(screen.queryByLabelText('カテゴリー絞り込み')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')

    expect(screen.getByLabelText('カテゴリー絞り込み')).toBeInTheDocument()
    expect(screen.getByText('ランチ')).toBeInTheDocument()
    expect(screen.queryByText('1月分給与')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('カテゴリー絞り込み')).getByText('食費')).toBeInTheDocument()
  })

  it('種別を収入に切り替えるとカテゴリー絞り込みが表示され収入のみ表示される', async () => {
    setupApi({ expenses: [lunchExpense], incomes: [salaryIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '収入')

    expect(screen.getByLabelText('カテゴリー絞り込み')).toBeInTheDocument()
    expect(screen.getByText('1月分給与')).toBeInTheDocument()
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('カテゴリー絞り込み')).getByText('給与')).toBeInTheDocument()
  })

  it('種別をすべてに戻すとカテゴリー絞り込みが非表示になる', async () => {
    setupApi({ expenses: [lunchExpense] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')
    expect(screen.getByLabelText('カテゴリー絞り込み')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), 'すべて')

    expect(screen.queryByLabelText('カテゴリー絞り込み')).not.toBeInTheDocument()
  })

  it('カテゴリー絞り込み後に種別をすべてに戻すと絞り込み前の全件が復元される', async () => {
    setupApi({ expenses: [lunchExpense, suppliesExpense], incomes: [salaryIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')
    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')
    await waitFor(() => expect(screen.queryByText('洗剤')).not.toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), 'すべて')

    await waitFor(() => expect(screen.getByText('洗剤')).toBeInTheDocument())
    expect(screen.getByText('ランチ')).toBeInTheDocument()
    expect(screen.getByText('1月分給与')).toBeInTheDocument()
  })

  it('支出のカテゴリー絞り込みでcategoryIdパラメータ付きで再取得する', async () => {
    const { calls } = setupApi({ expenses: [lunchExpense, suppliesExpense] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/expenses?categoryId=1')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('洗剤')).not.toBeInTheDocument())
  })

  it('収入のカテゴリー絞り込みでcategoryIdパラメータ付きで再取得する', async () => {
    const { calls } = setupApi({ incomes: [salaryIncome, bonusIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('1月分給与')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '収入')

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '給与')

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/incomes?categoryId=11')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('夏季賞与')).not.toBeInTheDocument())
  })

  it('登録ボタンを押すとモーダルが開き、すべて表示中は支出タブがデフォルトで選択される', async () => {
    setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())

    await openModal()

    const modal = screen.getByTestId('transaction-modal')
    expect(within(modal).getByRole('tab', { name: '支出' })).toHaveAttribute('aria-selected', 'true')
    expect(within(modal).getByLabelText('使用用途（任意）')).toBeInTheDocument()
    expect(within(modal).getByLabelText('世帯合計に含める')).toBeInTheDocument()
  })

  it('種別が収入のときに登録ボタンを押すと収入タブがデフォルトで選択される', async () => {
    setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '収入')

    await user.click(screen.getByRole('button', { name: '登録' }))

    const modal = screen.getByTestId('transaction-modal')
    expect(within(modal).getByRole('tab', { name: '収入' })).toHaveAttribute('aria-selected', 'true')
    expect(within(modal).getByLabelText('収入内容')).toBeInTheDocument()
    expect(within(modal).queryByLabelText('世帯合計に含める')).not.toBeInTheDocument()
  })

  it('モーダル内でタブを収入に切り替えると使用用途が収入内容に変わり世帯合計チェックボックスが消える', async () => {
    setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.click(within(modal).getByRole('tab', { name: '収入' }))

    expect(within(modal).getByLabelText('収入内容')).toBeInTheDocument()
    expect(within(modal).queryByLabelText('使用用途（任意）')).not.toBeInTheDocument()
    expect(within(modal).queryByLabelText('世帯合計に含める')).not.toBeInTheDocument()
  })

  it('支出を登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1500')
    await user.type(screen.getByLabelText('使用用途（任意）'), '書籍')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('書籍')).toBeInTheDocument())
    expect(screen.queryByTestId('transaction-modal')).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
    expect(postCall?.body).toMatchObject({
      amount: 1500,
      purpose: '書籍',
      categoryId: 1,
      includeInHouseholdTotal: false,
    })
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/expenses')).toHaveLength(2)
  })

  it('支出登録後の全件取得が遅れてもカテゴリー絞り込みを上書きせず、全件集計は更新する', async () => {
    const currentMonthExpense: Expense = {
      ...suppliesExpense,
      expenseDate: dateInMonth(0, 1),
    }
    const { state } = setupApi({ expenses: [currentMonthExpense] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('洗剤')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')

    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let unfilteredRefreshCount = 0
    server.use(
      http.get('/api/expenses', async ({ request }) => {
        const categoryId = new URL(request.url).searchParams.get('categoryId')
        if (categoryId !== null) {
          return HttpResponse.json(state.expenses.filter((expense) => expense.categoryId === Number(categoryId)))
        }

        unfilteredRefreshCount += 1
        const snapshot = [...state.expenses]
        await refreshGate
        return HttpResponse.json(snapshot)
      }),
    )

    await user.click(screen.getByRole('button', { name: '登録' }))
    const modal = screen.getByTestId('transaction-modal')
    await user.clear(within(modal).getByLabelText('金額'))
    await user.type(within(modal).getByLabelText('金額'), '1500')
    await user.type(within(modal).getByLabelText('使用用途（任意）'), '保存後の支出')
    await user.click(within(modal).getByRole('button', { name: '登録' }))
    await waitFor(() => expect(unfilteredRefreshCount).toBe(1))

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')
    await waitFor(() => expect(screen.getByText('保存後の支出')).toBeInTheDocument())
    expect(screen.queryByText('洗剤')).not.toBeInTheDocument()

    releaseRefresh?.()

    await waitFor(() => expect(screen.queryByTestId('transaction-modal')).not.toBeInTheDocument())
    expect(screen.queryByText('洗剤')).not.toBeInTheDocument()
    expect(screen.getByTestId('monthly-summary')).toHaveTextContent('今月支出：2300円')
  })

  it('収入を登録すると一覧に反映されモーダルが閉じ、リクエストに世帯合計フラグを含めない', async () => {
    const { calls } = setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')
    await user.click(within(modal).getByRole('tab', { name: '収入' }))

    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '250000')
    await user.type(screen.getByLabelText('収入内容'), '7月分給与')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('7月分給与')).toBeInTheDocument())
    expect(screen.queryByTestId('transaction-modal')).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/incomes')
    expect(postCall?.body).toMatchObject({
      amount: 250000,
      content: '7月分給与',
      categoryId: 11,
    })
    expect(postCall?.body).not.toHaveProperty('includeInHouseholdTotal')
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/incomes')).toHaveLength(2)
  })

  it('金額0以下はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '0')
    await user.type(screen.getByLabelText('使用用途（任意）'), '書籍')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('金額は1以上の整数で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('使用用途は任意なので空欄でも支出を登録できる', async () => {
    const { calls } = setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/expenses')).toBe(true))
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')!
    expect((post.body as { purpose: string }).purpose).toBe('')
  })

  it('収入内容が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')
    await user.click(within(modal).getByRole('tab', { name: '収入' }))

    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('収入内容は1〜100文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('キャンセルボタンでモーダルを閉じる', async () => {
    setupApi()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    await openModal()
    expect(screen.getByTestId('transaction-modal')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByTestId('transaction-modal')).not.toBeInTheDocument()
  })

  it('支出・収入いずれのカテゴリーも0件のとき登録ボタンを無効化する', async () => {
    setupApi()
    server.use(
      http.get('/api/kakeibo-categories', () => HttpResponse.json([])),
      http.get('/api/income-categories', () => HttpResponse.json([])),
    )
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
  })

  it('初期取得で支出一覧だけ失敗しても取得できた収入を反映する', async () => {
    setupApi({ incomes: [salaryIncome] })
    server.use(
      http.get('/api/expenses', () =>
        HttpResponse.json({ message: '支出一覧を取得できませんでした' }, { status: 500 }),
      ),
    )
    renderKakeiboPage()

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('支出一覧を取得できませんでした'),
    )

    expect(screen.getByText('1月分給与')).toBeInTheDocument()
  })

  it('収入カテゴリーが0件のとき、モーダル内の収入タブは無効化され不正なカテゴリーでは登録できない', async () => {
    const { calls } = setupApi()
    server.use(http.get('/api/income-categories', () => HttpResponse.json([])))
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '登録' })).toBeEnabled()
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    expect(within(modal).getByRole('tab', { name: '収入' })).toBeDisabled()
    await user.click(within(modal).getByRole('tab', { name: '収入' }))
    expect(within(modal).getByRole('tab', { name: '支出' })).toHaveAttribute('aria-selected', 'true')

    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/incomes')).toBe(false)
  })

  it('支出登録モーダルに口座/カードの選択肢が表示され、口座を選ぶとaccountIdが送信される', async () => {
    const { calls } = setupApi({
      accounts: [
        { id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [{ id: 50, name: '〇〇カード', accountId: 5, cardType: 'credit', balance: 0 }] },
      ],
    })
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.selectOptions(within(modal).getByLabelText('口座/カード（任意）'), '〇〇銀行')
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '3000')
    await user.type(screen.getByLabelText('使用用途（任意）'), '口座指定の支出')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('口座指定の支出')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
    expect(postCall?.body).toMatchObject({ accountId: 5, cardId: null })
  })

  it('支出登録モーダルでカードを選ぶとcardIdが送信される', async () => {
    const { calls } = setupApi({
      accounts: [
        { id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [{ id: 50, name: '〇〇カード', accountId: 5, cardType: 'credit', balance: 0 }] },
      ],
    })
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.selectOptions(within(modal).getByLabelText('口座/カード（任意）'), 'card:50')
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '2000')
    await user.type(screen.getByLabelText('使用用途（任意）'), 'カード指定の支出')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('カード指定の支出')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
    expect(postCall?.body).toMatchObject({ accountId: null, cardId: 50 })
  })

  it('一覧の口座列に支出に紐づく口座名が表示される', async () => {
    setupApi({
      expenses: [{ ...lunchExpense, accountId: 5 }],
      accounts: [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] }],
    })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    const table = screen.getByRole('table')
    expect(within(table).getByText('〇〇銀行')).toBeInTheDocument()
  })

  it('チャージ型カードでの支出はaccountIdがnullのため一覧の口座列にカード名が表示される', async () => {
    setupApi({
      expenses: [{ ...lunchExpense, accountId: null, cardId: 50 }],
      accounts: [
        {
          id: 5,
          name: '〇〇銀行',
          type: 'bank',
          balance: 10000,
          cards: [{ id: 50, name: 'Suica', accountId: 5, cardType: 'charge', balance: 3000 }],
        },
      ],
    })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    const table = screen.getByRole('table')
    expect(within(table).getByText('Suica')).toBeInTheDocument()
  })

  it('イベントを選択して支出登録するとeventIdが送信される', async () => {
    const { calls } = setupApi({
      events: [
        { id: 1, name: '旅行', eventDate: '2026-09-20', isAllDay: true, startTime: null, endTime: null, recurrenceType: 'none', notifyEnabled: false, defaultAmount: null, showOnDashboard: true, personal: false, editable: true },
      ],
    })
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.type(within(modal).getByLabelText('使用用途（任意）'), '旅行代')
    await user.clear(within(modal).getByLabelText('金額'))
    await user.type(within(modal).getByLabelText('金額'), '5000')
    await user.selectOptions(within(modal).getByLabelText('イベント（任意）'), '旅行')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('旅行代')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
    expect(postCall?.body).toMatchObject({ eventId: 1 })
  })

  it('デフォルト金額が設定されたイベントを選択すると金額欄に自動入力される', async () => {
    setupApi({
      events: [
        { id: 1, name: '旅行', eventDate: '2026-09-20', isAllDay: true, startTime: null, endTime: null, recurrenceType: 'none', notifyEnabled: false, defaultAmount: 3000, showOnDashboard: true, personal: false, editable: true },
      ],
    })
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('収支の記録はありません')).toBeInTheDocument())
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')

    await user.selectOptions(within(modal).getByLabelText('イベント（任意）'), '旅行')

    expect(within(modal).getByLabelText('金額')).toHaveValue(3000)
  })
})

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

// テスト実行日に依存せず「今月」「前月」の日付文字列を動的に算出する
// (MenuPage.test.tsxのgetMondayOf(new Date())と同じ考え方)。
function dateInMonth(monthsAgo: number, day: number): string {
  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() - monthsAgo)
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(day)}`
}

describe('KakeiboPage 今月支出/今月収入/世帯合計対象額サマリー', () => {
  it('当月の支出・収入のみ合算して表示し、世帯合計対象額はdashboard/summaryの値をそのまま表示する', async () => {
    setupApi({
      expenses: [
        { ...lunchExpense, id: 1, expenseDate: dateInMonth(0, 1), amount: 1200 },
        { ...suppliesExpense, id: 2, expenseDate: dateInMonth(0, 2), amount: 800 },
        { ...lunchExpense, id: 3, expenseDate: dateInMonth(1, 15), amount: 9999 },
      ],
      incomes: [
        { ...salaryIncome, id: 1, incomeDate: dateInMonth(0, 25), amount: 300000 },
        { ...bonusIncome, id: 2, incomeDate: dateInMonth(1, 10), amount: 999999 },
      ],
      dashboardSummary: { shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal: 45300 },
    })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByTestId('monthly-summary')).toHaveTextContent('今月支出：2000円'))
    expect(screen.getByTestId('monthly-summary')).toHaveTextContent('今月収入：300000円')
    expect(screen.getByTestId('monthly-summary')).toHaveTextContent('世帯合計対象額：45300円')
  })

  it('カテゴリー絞り込み中も今月支出・今月収入は全カテゴリーの合計を表示する', async () => {
    setupApi({
      expenses: [
        { ...lunchExpense, expenseDate: dateInMonth(0, 1), amount: 1200 },
        { ...suppliesExpense, expenseDate: dateInMonth(0, 2), amount: 800 },
      ],
      incomes: [
        { ...salaryIncome, incomeDate: dateInMonth(0, 3), amount: 300000 },
        { ...bonusIncome, incomeDate: dateInMonth(0, 4), amount: 500000 },
      ],
    })
    const user = userEvent.setup()
    renderKakeiboPage()
    const summary = await screen.findByTestId('monthly-summary')
    await waitFor(() => expect(summary).toHaveTextContent('今月支出：2000円'))
    expect(summary).toHaveTextContent('今月収入：800000円')

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '支出')
    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')
    await waitFor(() => expect(screen.queryByText('洗剤')).not.toBeInTheDocument())
    expect(summary).toHaveTextContent('今月支出：2000円')
    expect(summary).toHaveTextContent('今月収入：800000円')

    await user.selectOptions(screen.getByLabelText('種別絞り込み'), '収入')
    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '給与')
    await waitFor(() => expect(screen.queryByText('夏季賞与')).not.toBeInTheDocument())
    expect(summary).toHaveTextContent('今月支出：2000円')
    expect(summary).toHaveTextContent('今月収入：800000円')
  })
})

describe('KakeiboPage 世帯合計対象額の再取得', () => {
  it('世帯合計対象で支出を登録すると世帯合計対象額が再取得され更新される', async () => {
    let householdExpenseTotal = 0
    setupApi()
    // setupApiが登録するデフォルトの/api/dashboard/summaryハンドラを、
    // 動的に値を返すこちらのハンドラで上書きする(server.useは後から登録した方が優先される)。
    server.use(
      http.get('/api/dashboard/summary', () =>
        HttpResponse.json({ shoppingListCount: 0, lowStockCount: 0, householdExpenseTotal }),
      ),
    )
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByTestId('monthly-summary')).toHaveTextContent('世帯合計対象額：0円'))

    householdExpenseTotal = 3000
    const user = await openModal()
    const modal = screen.getByTestId('transaction-modal')
    await user.clear(within(modal).getByLabelText('金額'))
    await user.type(within(modal).getByLabelText('金額'), '3000')
    await user.click(within(modal).getByLabelText('世帯合計に含める'))
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByTestId('monthly-summary')).toHaveTextContent('世帯合計対象額：3000円'))
  })
})

describe('KakeiboPage イベント別支出サマリー', () => {
  const dashboardEvent: Event = {
    id: 1,
    name: '旅行',
    eventDate: '2026-09-20',
    isAllDay: true,
    startTime: null,
    endTime: null,
    recurrenceType: 'none',
    notifyEnabled: false,
    defaultAmount: null,
    showOnDashboard: true,
    personal: false,
    editable: true,
  }
  const hiddenEvent: Event = { ...dashboardEvent, id: 2, name: '非表示イベント', showOnDashboard: false }

  it('showOnDashboard=trueのイベントのみ表示され、デフォルトは今年の集計を取得する', async () => {
    const { calls } = setupApi({
      events: [dashboardEvent, hiddenEvent],
      eventSummaries: { 1: { year: 15000, month: 3000 } },
    })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('旅行：15000円')).toBeInTheDocument())
    expect(screen.queryByText('非表示イベント')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/events/1/summary?period=year')).toBe(true)
  })

  it('期間セレクトを今月に切り替えると今月の集計に更新される', async () => {
    setupApi({
      events: [dashboardEvent],
      eventSummaries: { 1: { year: 15000, month: 3000 } },
    })
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('旅行：15000円')).toBeInTheDocument())
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('イベント支出（対象期間）'), '今月')

    await waitFor(() => expect(screen.getByText('旅行：3000円')).toBeInTheDocument())
  })

  it('対象イベントが無いときは案内文を表示する', async () => {
    setupApi({ events: [] })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('ダッシュボード表示対象のイベントはありません')).toBeInTheDocument())
  })
})
