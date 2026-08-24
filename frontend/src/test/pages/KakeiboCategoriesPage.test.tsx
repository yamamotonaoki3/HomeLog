import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { KakeiboCategoriesPage } from '../../pages/KakeiboCategoriesPage'
import type { IncomeCategory, KakeiboCategory } from '../../api/kakeiboTypes'

function setupApi(
  initial: { expenseCategories?: KakeiboCategory[]; incomeCategories?: IncomeCategory[] } = {},
) {
  const state = {
    expenseCategories: initial.expenseCategories ?? [],
    incomeCategories: initial.incomeCategories ?? [],
  }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/kakeibo-categories', () => {
      calls.push({ method: 'GET', url: '/api/kakeibo-categories' })
      return HttpResponse.json(state.expenseCategories)
    }),
    http.post('/api/kakeibo-categories', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/kakeibo-categories', body })
      const category: KakeiboCategory = { id: nextId++, name: body.name as string, isDefault: false }
      state.expenseCategories.push(category)
      return HttpResponse.json(category, { status: 201 })
    }),
    http.patch('/api/kakeibo-categories/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/kakeibo-categories/${params.id}`, body })
      const target = state.expenseCategories.find((c) => c.id === Number(params.id))
      if (target) target.name = body.name as string
      return HttpResponse.json(target)
    }),
    http.delete('/api/kakeibo-categories/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/kakeibo-categories/${params.id}` })
      state.expenseCategories = state.expenseCategories.filter((c) => c.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/income-categories', () => {
      calls.push({ method: 'GET', url: '/api/income-categories' })
      return HttpResponse.json(state.incomeCategories)
    }),
    http.post('/api/income-categories', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/income-categories', body })
      const category: IncomeCategory = { id: nextId++, name: body.name as string, isDefault: false }
      state.incomeCategories.push(category)
      return HttpResponse.json(category, { status: 201 })
    }),
    http.patch('/api/income-categories/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/income-categories/${params.id}`, body })
      const target = state.incomeCategories.find((c) => c.id === Number(params.id))
      if (target) target.name = body.name as string
      return HttpResponse.json(target)
    }),
    http.delete('/api/income-categories/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/income-categories/${params.id}` })
      state.incomeCategories = state.incomeCategories.filter((c) => c.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/categories']}>
      <KakeiboCategoriesPage />
    </MemoryRouter>,
  )
}

describe('KakeiboCategoriesPage', () => {
  it('初期表示で支出カテゴリータブがアクティブで一覧が表示される', async () => {
    setupApi({
      expenseCategories: [
        { id: 1, name: '食費', isDefault: true },
        { id: 2, name: '自己啓発', isDefault: false },
      ],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('食費')).toBeInTheDocument())
    expect(screen.getByText('自己啓発')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '支出カテゴリー' })).toHaveAttribute('aria-selected', 'true')
  })

  it('デフォルトカテゴリーには編集・削除ボタンが表示されずカスタムカテゴリーには表示される', async () => {
    setupApi({
      expenseCategories: [
        { id: 1, name: '食費', isDefault: true },
        { id: 2, name: '自己啓発', isDefault: false },
      ],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('食費')).toBeInTheDocument())
    const foodRow = screen.getByText('食費').closest('tr') as HTMLElement
    const customRow = screen.getByText('自己啓発').closest('tr') as HTMLElement
    expect(foodRow.querySelector('button')).toBeNull()
    expect(customRow.querySelector('button')).not.toBeNull()
  })

  it('収入カテゴリータブに切り替えると収入カテゴリー一覧が表示される', async () => {
    setupApi({
      expenseCategories: [{ id: 1, name: '食費', isDefault: true }],
      incomeCategories: [{ id: 11, name: '給与', isDefault: true }],
    })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('食費')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '収入カテゴリー' }))

    expect(screen.getByText('給与')).toBeInTheDocument()
    expect(screen.queryByText('食費')).not.toBeInTheDocument()
  })

  it('タブ切り替え時に追加のAPI呼び出しは発生しない', async () => {
    const { calls } = setupApi({
      expenseCategories: [{ id: 1, name: '食費', isDefault: true }],
      incomeCategories: [{ id: 11, name: '給与', isDefault: true }],
    })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('食費')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '収入カテゴリー' }))
    await user.click(screen.getByRole('tab', { name: '支出カテゴリー' }))

    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/kakeibo-categories')).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/income-categories')).toHaveLength(1)
  })

  it('支出カテゴリーを登録するとPOST /api/kakeibo-categoriesが呼ばれ一覧に反映される', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), '交通費')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('交通費')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/kakeibo-categories')
    expect(postCall?.body).toMatchObject({ name: '交通費' })
  })

  it('収入タブで登録するとPOST /api/income-categoriesが呼ばれる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '収入カテゴリー' }))
    await user.click(screen.getByRole('button', { name: '収入カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), '臨時収入')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('臨時収入')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/income-categories')
    expect(postCall?.body).toMatchObject({ name: '臨時収入' })
  })

  it('カテゴリー名が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出カテゴリーを登録' }))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('カテゴリー名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('カテゴリー名が51文字はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), 'あ'.repeat(51))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('カテゴリー名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('カテゴリー名がちょうど50文字なら登録できる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    const name = 'あ'.repeat(50)
    await user.click(screen.getByRole('button', { name: '支出カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), name)
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/kakeibo-categories')).toBe(true)
  })

  it('カテゴリーを編集すると一覧に反映される', async () => {
    const { calls } = setupApi({ expenseCategories: [{ id: 2, name: '自己啓発', isDefault: false }] })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('自己啓発')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('heading', { name: '支出カテゴリーを編集' })).toBeInTheDocument()
    const nameInput = screen.getByLabelText('カテゴリー名')
    await user.clear(nameInput)
    await user.type(nameInput, '趣味')
    await user.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getByText('趣味')).toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/kakeibo-categories/2')
    expect(patchCall?.body).toMatchObject({ name: '趣味' })
  })

  it('カテゴリーを削除すると一覧から消える', async () => {
    const { calls } = setupApi({ expenseCategories: [{ id: 2, name: '自己啓発', isDefault: false }] })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('自己啓発')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.getByRole('heading', { name: 'カテゴリーを削除しますか？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/kakeibo-categories/2')).toBe(true)
  })

  it('削除確認ダイアログでキャンセルすると削除されない', async () => {
    const { calls } = setupApi({ expenseCategories: [{ id: 2, name: '自己啓発', isDefault: false }] })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('自己啓発')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.getByText('自己啓発')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('使用中カテゴリーの削除は400エラーがToast表示され一覧に残る', async () => {
    setupApi({ expenseCategories: [{ id: 2, name: '自己啓発', isDefault: false }] })
    server.use(
      http.delete('/api/kakeibo-categories/:id', () =>
        HttpResponse.json({ message: '使用中のカテゴリーは削除できません' }, { status: 400 }),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('自己啓発')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('使用中のカテゴリーは削除できません')).toBeInTheDocument())
    expect(screen.getByText('自己啓発')).toBeInTheDocument()
  })

  it('削除成功後の一覧再取得に失敗しても、削除自体は成功として一覧から消えたままになる', async () => {
    setupApi({ expenseCategories: [{ id: 2, name: '自己啓発', isDefault: false }] })
    let getCount = 0
    server.use(
      http.get('/api/kakeibo-categories', () => {
        getCount += 1
        return getCount === 1
          ? HttpResponse.json([{ id: 2, name: '自己啓発', isDefault: false }])
          : HttpResponse.json({ message: 'カテゴリー一覧の取得に失敗しました' }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('自己啓発')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())
    expect(screen.getByText('カテゴリー一覧の取得に失敗しました')).toBeInTheDocument()
  })

  it('キャンセルボタンで登録モーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('カテゴリーはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '支出カテゴリーを登録' }))
    expect(screen.getByRole('heading', { name: '支出カテゴリーを登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('heading', { name: '支出カテゴリーを登録' })).not.toBeInTheDocument()
  })

  it('カテゴリー一覧初回取得に失敗した場合はToastでエラー表示する', async () => {
    server.use(
      http.get('/api/kakeibo-categories', () =>
        HttpResponse.json({ message: 'カテゴリーの取得に失敗しました' }, { status: 500 }),
      ),
      http.get('/api/income-categories', () => HttpResponse.json([])),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('カテゴリーの取得に失敗しました')).toBeInTheDocument())
  })
})
