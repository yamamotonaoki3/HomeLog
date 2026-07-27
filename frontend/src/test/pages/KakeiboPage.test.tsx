import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { KakeiboPage } from '../../pages/KakeiboPage'
import type { Expense, Income } from '../../api/kakeiboTypes'

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
}

/** 家計簿API一式を状態ベースでモックし、リクエスト記録と状態を返す */
function setupApi(initial: Partial<MockState> = {}) {
  const state: MockState = {
    expenses: initial.expenses ?? [],
    incomes: initial.incomes ?? [],
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
}
const suppliesExpense: Expense = {
  id: 2,
  expenseDate: '2026-01-02',
  amount: 800,
  purpose: '洗剤',
  categoryId: 2,
  memo: null,
  includeInHouseholdTotal: true,
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

describe('KakeiboPage', () => {
  it('支出一覧がカテゴリー名付きで表示される', async () => {
    setupApi({ expenses: [lunchExpense] })
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())
    const table = screen.getByRole('table')
    expect(within(table).getByText('食費')).toBeInTheDocument()
    expect(within(table).getByText('1200')).toBeInTheDocument()
  })

  it('支出が空のときプレースホルダーを表示する', async () => {
    setupApi()
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())
  })

  it('カテゴリー絞り込みでcategoryIdパラメータ付きで再取得する', async () => {
    const { calls } = setupApi({ expenses: [lunchExpense, suppliesExpense] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/expenses?categoryId=1')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('洗剤')).not.toBeInTheDocument())
  })

  it('カテゴリー絞り込みの取得に失敗した場合は選択状態と一覧を変更しない', async () => {
    setupApi({ expenses: [lunchExpense, suppliesExpense] })
    server.use(
      http.get('/api/expenses', ({ request }) => {
        const categoryId = new URL(request.url).searchParams.get('categoryId')
        if (categoryId === '1') {
          return HttpResponse.json({ message: '一覧を取得できませんでした' }, { status: 500 })
        }
        return HttpResponse.json([lunchExpense, suppliesExpense])
      }),
    )
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('一覧を取得できませんでした'),
    )
    expect(screen.getByLabelText('カテゴリー絞り込み')).toHaveValue('')
    expect(screen.getByText('ランチ')).toBeInTheDocument()
    expect(screen.getByText('洗剤')).toBeInTheDocument()
  })

  it('カテゴリー絞り込みを連続変更しても最新のレスポンスだけを表示する', async () => {
    setupApi({ expenses: [lunchExpense, suppliesExpense] })
    let resolveFirstRequest: (() => void) | undefined
    let firstRequestCompleted = false
    server.use(
      http.get('/api/expenses', async ({ request }) => {
        const categoryId = new URL(request.url).searchParams.get('categoryId')
        if (categoryId === '1') {
          await new Promise<void>((resolve) => {
            resolveFirstRequest = resolve
          })
          firstRequestCompleted = true
          return HttpResponse.json([lunchExpense])
        }
        if (categoryId === '2') return HttpResponse.json([suppliesExpense])
        return HttpResponse.json([lunchExpense, suppliesExpense])
      }),
    )
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('ランチ')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '食費')
    await waitFor(() => expect(resolveFirstRequest).toBeDefined())
    await user.selectOptions(screen.getByLabelText('カテゴリー絞り込み'), '日用品')
    await waitFor(() => expect(screen.getByText('洗剤')).toBeInTheDocument())

    resolveFirstRequest?.()

    await waitFor(() => expect(firstRequestCompleted).toBe(true))
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()
    expect(screen.getByText('洗剤')).toBeInTheDocument()
  })

  it('支出を登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1500')
    await user.type(screen.getByLabelText('使用用途'), '書籍')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('書籍')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
    expect(postCall?.body).toMatchObject({
      amount: 1500,
      purpose: '書籍',
      categoryId: 1,
      includeInHouseholdTotal: false,
    })
  })

  it('支出登録後の一覧再取得に失敗した場合はToastを表示してモーダルを開いたままにする', async () => {
    const { calls } = setupApi()
    let expenseGetCount = 0
    server.use(
      http.get('/api/expenses', () => {
        expenseGetCount += 1
        if (expenseGetCount === 1) return HttpResponse.json([])
        return HttpResponse.json({ message: '一覧を更新できませんでした' }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    await user.type(screen.getByLabelText('金額'), '1500')
    await user.type(screen.getByLabelText('使用用途'), '書籍')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('一覧を更新できませんでした'),
    )
    const submitButton = screen.getByRole('button', { name: '登録' })
    expect(submitButton).toBeDisabled()

    await user.click(submitButton)

    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/expenses')).toHaveLength(1)
  })

  it('世帯合計対象フラグをチェックすると送信内容に反映される', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '3000')
    await user.type(screen.getByLabelText('使用用途'), '家族の食事')
    await user.click(screen.getByLabelText('世帯合計に含める'))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/expenses')
      expect(postCall?.body).toMatchObject({ includeInHouseholdTotal: true })
    })
  })

  it('金額0以下はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '0')
    await user.type(screen.getByLabelText('使用用途'), '書籍')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('金額は1以上の整数で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/expenses')).toBe(false)
  })

  it('使用用途が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('使用用途は1〜100文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/expenses')).toBe(false)
  })

  it('キャンセルボタンでモーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出を登録' }))
    expect(screen.getByRole('button', { name: '登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('button', { name: '登録' })).not.toBeInTheDocument()
  })

  it('カテゴリーが0件のとき支出登録ボタンを無効化する', async () => {
    setupApi()
    server.use(
      http.get('/api/kakeibo-categories', () => HttpResponse.json([])),
    )
    renderKakeiboPage()

    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '支出を登録' })).toBeDisabled()
  })

  it('初期取得で支出一覧だけ失敗しても取得できたカテゴリーを反映する', async () => {
    setupApi()
    server.use(
      http.get('/api/expenses', () =>
        HttpResponse.json({ message: '支出一覧を取得できませんでした' }, { status: 500 }),
      ),
    )
    renderKakeiboPage()

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('支出一覧を取得できませんでした'),
    )

    expect(screen.getByRole('button', { name: '支出を登録' })).toBeEnabled()
    expect(screen.getByLabelText('カテゴリー絞り込み')).toHaveTextContent('食費')
  })

  it('収入タブに切り替えると収入一覧がカテゴリー名付きで表示される', async () => {
    setupApi({ incomes: [salaryIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '収入' }))

    await waitFor(() => expect(screen.getByText('1月分給与')).toBeInTheDocument())
    const table = screen.getByRole('table')
    expect(within(table).getByText('給与')).toBeInTheDocument()
    expect(within(table).getByText('300000')).toBeInTheDocument()
  })

  it('収入が空のときプレースホルダーを表示する', async () => {
    setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.getByText('支出はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '収入' }))

    await waitFor(() => expect(screen.getByText('収入はありません')).toBeInTheDocument())
  })

  it('収入カテゴリー絞り込みでcategoryIdパラメータ付きで再取得する', async () => {
    const { calls } = setupApi({ incomes: [salaryIncome, bonusIncome] })
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '収入' }))
    await waitFor(() => expect(screen.getByText('1月分給与')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('収入カテゴリー絞り込み'), '給与')

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/incomes?categoryId=11')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('夏季賞与')).not.toBeInTheDocument())
  })

  it('収入を登録すると一覧に反映されモーダルが閉じ、世帯合計チェックボックスは存在しない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '収入' }))
    await waitFor(() => expect(screen.getByText('収入はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '収入を登録' }))
    expect(screen.queryByLabelText('世帯合計に含める')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '250000')
    await user.type(screen.getByLabelText('収入内容'), '7月分給与')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('7月分給与')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/incomes')
    expect(postCall?.body).toMatchObject({
      amount: 250000,
      content: '7月分給与',
      categoryId: 11,
    })
    expect(postCall?.body).not.toHaveProperty('includeInHouseholdTotal')
  })

  it('収入の金額0以下はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '収入' }))
    await waitFor(() => expect(screen.getByText('収入はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '収入を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '0')
    await user.type(screen.getByLabelText('収入内容'), '給与')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('金額は1以上の整数で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/incomes')).toBe(false)
  })

  it('収入内容が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '収入' }))
    await waitFor(() => expect(screen.getByText('収入はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '収入を登録' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('収入内容は1〜100文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/incomes')).toBe(false)
  })

  it('収入カテゴリーが0件のとき収入登録ボタンを無効化する', async () => {
    setupApi()
    server.use(
      http.get('/api/income-categories', () => HttpResponse.json([])),
    )
    const user = userEvent.setup()
    renderKakeiboPage()
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '収入' }))

    await waitFor(() => expect(screen.getByText('収入はありません')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '収入を登録' })).toBeDisabled()
  })
})
