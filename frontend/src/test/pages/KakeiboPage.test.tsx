import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { KakeiboPage } from '../../pages/KakeiboPage'
import type { Expense } from '../../api/kakeiboTypes'

const defaultCategories = [
  { id: 1, name: '食費', isDefault: true },
  { id: 2, name: '日用品', isDefault: true },
]

interface MockState {
  expenses: Expense[]
}

/** 家計簿API一式を状態ベースでモックし、リクエスト記録と状態を返す */
function setupApi(initial: Partial<MockState> = {}) {
  const state: MockState = {
    expenses: initial.expenses ?? [],
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
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({
      amount: 1500,
      purpose: '書籍',
      categoryId: 1,
      includeInHouseholdTotal: false,
    })
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
      const postCall = calls.find((c) => c.method === 'POST')
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
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
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
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
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
})
