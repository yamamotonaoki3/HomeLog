import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { MenuPage } from '../../pages/MenuPage'
import { getMondayOf } from '../../lib/week'
import type { MenuEntry, Recipe } from '../../api/kondateTypes'

function setupApi(initial: { entries?: Record<string, MenuEntry[]>; recipes?: Recipe[] } = {}) {
  const state = { entries: initial.entries ?? {}, recipes: initial.recipes ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/menu-entries', ({ request }) => {
      const url = new URL(request.url)
      const weekStartDate = url.searchParams.get('weekStartDate') ?? ''
      calls.push({ method: 'GET', url: `/api/menu-entries?weekStartDate=${weekStartDate}` })
      return HttpResponse.json(state.entries[weekStartDate] ?? [])
    }),
    http.get('/api/recipes', () => HttpResponse.json(state.recipes)),
    http.post('/api/menu-entries', async ({ request }) => {
      const body = (await request.json()) as { weekStartDate: string; recipeId?: number | null; freeTextMemo?: string | null }
      calls.push({ method: 'POST', url: '/api/menu-entries', body })
      const recipe = body.recipeId != null ? state.recipes.find((r) => r.id === body.recipeId) : undefined
      const entry: MenuEntry = {
        id: nextId++,
        recipeId: body.recipeId ?? null,
        recipeTitle: recipe?.title ?? null,
        freeTextMemo: body.freeTextMemo ?? null,
        weekStartDate: body.weekStartDate,
      }
      state.entries[body.weekStartDate] = [...(state.entries[body.weekStartDate] ?? []), entry]
      return HttpResponse.json(entry, { status: 201 })
    }),
    http.delete('/api/menu-entries/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/menu-entries/${params.id}` })
      for (const week of Object.keys(state.entries)) {
        state.entries[week] = state.entries[week].filter((e) => e.id !== Number(params.id))
      }
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderMenuPage() {
  return render(
    <MemoryRouter initialEntries={['/menu']}>
      <MenuPage />
    </MemoryRouter>,
  )
}

describe('MenuPage', () => {
  it('今週の献立が無い場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderMenuPage()

    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())
  })

  it('今週の献立リストが表示される', async () => {
    const monday = getMondayOf(new Date())
    setupApi({
      entries: {
        [monday]: [
          { id: 1, recipeId: 10, recipeTitle: '肉じゃが', freeTextMemo: null, weekStartDate: monday },
          { id: 2, recipeId: null, recipeTitle: null, freeTextMemo: '外食', weekStartDate: monday },
        ],
      },
    })
    renderMenuPage()

    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeInTheDocument())
    expect(screen.getByText('外食')).toBeInTheDocument()
  })

  it('レシピが削除済み(recipeIdはあるがrecipeTitleがnull)の場合はフォールバック表示する', async () => {
    const monday = getMondayOf(new Date())
    setupApi({
      entries: {
        [monday]: [{ id: 1, recipeId: 10, recipeTitle: null, freeTextMemo: null, weekStartDate: monday }],
      },
    })
    renderMenuPage()

    await waitFor(() => expect(screen.getByText('(削除されたレシピ)')).toBeInTheDocument())
  })

  it('次週▶ボタンで翌週の献立を取得する', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(calls.some((c) => c.url.includes(monday))).toBe(true))

    await user.click(screen.getByRole('button', { name: '次週 ▶' }))

    await waitFor(() => {
      const nextWeekCalls = calls.filter((c) => c.method === 'GET' && !c.url.includes(monday))
      expect(nextWeekCalls.length).toBeGreaterThan(0)
    })
  })

  it('◀前週→次週▶で元の週に戻る', async () => {
    const monday = getMondayOf(new Date())
    setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText(`${monday} の週`)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '◀ 前週' }))
    await waitFor(() => expect(screen.queryByText(`${monday} の週`)).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '次週 ▶' }))
    await waitFor(() => expect(screen.getByText(`${monday} の週`)).toBeInTheDocument())
  })

  it('レシピを選択して確定登録できる', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi({ recipes: [{ id: 10, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', isFavorite: false }] })
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('レシピ'), '10')
    await user.click(screen.getByRole('button', { name: '追加' }))

    const list = screen.getByRole('list')
    await waitFor(() => expect(within(list).getByText('肉じゃが')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({ weekStartDate: monday, recipeId: 10 })
  })

  it('自由メモでラフ登録できる', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: '自由メモ' }))
    await user.type(screen.getByLabelText('自由メモの内容'), '魚料理')
    await user.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(screen.getByText('魚料理')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({ weekStartDate: monday, freeTextMemo: '魚料理' })
  })

  it('レシピ未選択のまま追加しようとするとクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi({ recipes: [{ id: 10, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', isFavorite: false }] })
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(screen.getByText('レシピを選択してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('献立を削除すると一覧から消える', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi({
      entries: { [monday]: [{ id: 1, recipeId: null, recipeTitle: null, freeTextMemo: '外食', weekStartDate: monday }] },
    })
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('外食')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/menu-entries/1')).toBe(true)
  })

  it('お気に入りのレシピがプルダウンの先頭に表示される', async () => {
    setupApi({
      recipes: [
        { id: 1, title: '通常レシピ', ingredients: null, steps: null, sourceType: 'manual', isFavorite: false },
        { id: 2, title: 'お気に入りレシピ', ingredients: null, steps: null, sourceType: 'manual', isFavorite: true },
      ],
    })
    renderMenuPage()

    await waitFor(() => expect(screen.getByLabelText('レシピ')).toBeInTheDocument())
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options.indexOf('★ お気に入りレシピ')).toBeLessThan(options.indexOf('通常レシピ'))
  })
})
