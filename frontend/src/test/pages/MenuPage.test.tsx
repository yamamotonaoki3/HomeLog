import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { MenuPage } from '../../pages/MenuPage'
import { addWeeks, getMondayOf } from '../../lib/week'
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
  it('週ボタンは矢印のみで読み上げ名を持つ', async () => {
    setupApi()
    renderMenuPage()
    for (const [name, arrow] of [['先週', '◀'], ['次週', '▶']]) {
      const button = await screen.findByRole('button', { name })
      expect(button).toHaveAccessibleName(name)
      expect(button.textContent?.trim()).toBe(arrow)
      expect(within(button).getByText(arrow)).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it.each([false, true])('週ごとの一覧・取得日・復帰を検証する（年境界: %s）', async (yearBoundary) => {
    if (yearBoundary) vi.setSystemTime(new Date(2026, 11, 30, 12))
    try {
      const monday = getMondayOf(new Date())
      const previous = addWeeks(monday, -1)
      const next = addWeeks(monday, 1)
      const entries = Object.fromEntries([previous, monday, next].map((week, i) => [week, [{
        id: i + 1, recipeId: null, recipeTitle: null, freeTextMemo: `[E2E_TEST] ${week}`, weekStartDate: week,
      }]]))
      const { calls } = setupApi({ entries })
      const user = userEvent.setup()
      renderMenuPage()
      await screen.findByText(`[E2E_TEST] ${monday}`)
      for (const [name, week] of [['先週', previous], ['次週', monday], ['次週', next], ['先週', monday]]) {
        await user.click(screen.getByRole('button', { name }))
        await screen.findByText(`[E2E_TEST] ${week}`)
        expect(screen.getByText(`${week} の週`)).toBeInTheDocument()
        expect(screen.getAllByRole('listitem')).toHaveLength(1)
        expect(calls.at(-1)?.url).toBe(`/api/menu-entries?weekStartDate=${week}`)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('EnterとSpaceで週を切り替える', async () => {
    const monday = getMondayOf(new Date())
    setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    const previous = await screen.findByRole('button', { name: '先週' })
    previous.focus()
    await user.keyboard('{Enter}')
    await screen.findByText(`${addWeeks(monday, -1)} の週`)
    screen.getByRole('button', { name: '次週' }).focus()
    await user.keyboard(' ')
    await screen.findByText(`${monday} の週`)
  })
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

    await user.click(screen.getByRole('button', { name: '次週' }))

    await waitFor(() => {
      const nextWeekCalls = calls.filter((c) => c.method === 'GET' && c.url === `/api/menu-entries?weekStartDate=${addWeeks(monday, 1)}`)
      expect(nextWeekCalls.length).toBeGreaterThan(0)
    })
  })

  it('◀前週→次週▶で元の週に戻る', async () => {
    const monday = getMondayOf(new Date())
    setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText(`${monday} の週`)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '先週' }))
    await screen.findByText(`${addWeeks(monday, -1)} の週`)

    await user.click(screen.getByRole('button', { name: '次週' }))
    await waitFor(() => expect(screen.getByText(`${monday} の週`)).toBeInTheDocument())
  })

  it('レシピを選択して確定登録できる', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi({ recipes: [{ id: 10, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }] })
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: '肉じゃが' }))
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: '追加' }))

    const list = screen.getByRole('list')
    await waitFor(() => expect(within(list).getByText('肉じゃが')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({ weekStartDate: monday, recipeId: 10 })
  })

  it('キーワードでレシピの選択肢を絞り込み、選んだレシピで追加できる (#281)', async () => {
    const monday = getMondayOf(new Date())
    const base = { ingredients: null, steps: null, sourceType: 'manual' as const, url: null, thumbnailUrl: null, memo: null, isFavorite: false }
    const { calls } = setupApi({ recipes: [{ ...base, id: 10, title: '肉じゃが' }, { ...base, id: 11, title: '鶏の唐揚げ' }, { ...base, id: 12, title: 'Pasta Carbonara' }] })
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())
    const candidates = screen.getByRole('group', { name: 'レシピ候補' })
    const options = () => within(candidates).queryAllByRole('radio').map(radio => radio.getAttribute('value'))
    expect(options()).toEqual(['10', '11', '12'])

    await user.type(screen.getByLabelText('レシピを検索'), '唐揚')
    expect(options()).toEqual(['11'])
    expect(screen.getByRole('radio', { name: '鶏の唐揚げ' })).toBeVisible()
    await user.clear(screen.getByLabelText('レシピを検索'))
    await user.type(screen.getByLabelText('レシピを検索'), 'ＰＡＳＴＡ')
    expect(options()).toEqual(['12'])
    await user.click(screen.getByRole('radio', { name: 'Pasta Carbonara' }))
    await user.type(screen.getByLabelText('レシピを検索'), 'x')
    expect(options()).toEqual([])
    expect(within(candidates).getByText('該当するレシピがありません')).toBeVisible()
    await user.clear(screen.getByLabelText('レシピを検索'))
    expect(options()).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Pasta Carbonara' })).not.toBeChecked()
    await user.click(screen.getByRole('radio', { name: '鶏の唐揚げ' }))
    await user.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ weekStartDate: monday, recipeId: 11 }))
  })

  it.each([['からあげ', 'カラアゲ'], ['カラアゲ', 'からあげ']])('タイトル%sを%sで即座に検索できる', async (title, keyword) => {
    setupApi({ recipes: [{ id: 10, title, ingredients: null, steps: null, sourceType: 'web', url: 'https://www.youtube.com/watch?v=example', thumbnailUrl: null, memo: null, isFavorite: false }] })
    const user = userEvent.setup()
    renderMenuPage()
    const search = await screen.findByRole('searchbox', { name: 'レシピを検索' })
    await user.type(search, keyword)
    expect(screen.getByRole('radio', { name: title })).toBeVisible()
    await user.type(search, '該当なし')
    expect(screen.queryByRole('radio', { name: title })).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByRole('radio', { name: title })).toBeVisible()
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
    const { calls } = setupApi({ recipes: [{ id: 10, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }] })
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

  it('お気に入りのレシピが候補一覧の先頭に表示される', async () => {
    setupApi({
      recipes: [
        { id: 1, title: '通常レシピ', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false },
        { id: 2, title: 'お気に入りレシピ', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: true },
      ],
    })
    renderMenuPage()

    const group = await screen.findByRole('group', { name: 'レシピ候補' })
    expect(within(group).getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual(['2', '1'])
  })

  it('レシピのタイトルから元ページ・レシピ詳細を開ける。手入力の献立はリンクにしない (#289)', async () => {
    const monday = getMondayOf(new Date())
    const base = { ingredients: null, steps: null, thumbnailUrl: null, memo: null, isFavorite: false }
    setupApi({
      entries: {
        [monday]: [
          { id: 1, recipeId: 10, recipeTitle: '[E2E_TEST] 動画レシピ', freeTextMemo: null, weekStartDate: monday },
          { id: 2, recipeId: 11, recipeTitle: '[E2E_TEST] 手入力レシピ', freeTextMemo: null, weekStartDate: monday },
          { id: 3, recipeId: null, recipeTitle: null, freeTextMemo: '外食', weekStartDate: monday },
        ],
      },
      recipes: [
        { ...base, id: 10, title: '[E2E_TEST] 動画レシピ', sourceType: 'web', url: 'https://recipe.example.com/video' },
        { ...base, id: 11, title: '[E2E_TEST] 手入力レシピ', sourceType: 'manual', url: null, ingredients: 'じゃがいも' },
      ],
    })
    renderMenuPage()
    const user = userEvent.setup()

    const link = await screen.findByRole('link', { name: '[E2E_TEST] 動画レシピ' })
    expect(link).toHaveAttribute('href', 'https://recipe.example.com/video')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(screen.getByRole('button', { name: '[E2E_TEST] 手入力レシピ' }))
    const dialog = screen.getByRole('dialog', { name: 'レシピ詳細' })
    expect(dialog).toHaveTextContent('じゃがいも')
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()

    expect(screen.queryByRole('link', { name: '外食' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '外食' })).not.toBeInTheDocument()
  })
})
