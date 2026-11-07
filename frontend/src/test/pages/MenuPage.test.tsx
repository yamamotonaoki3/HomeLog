import { StrictMode } from 'react'
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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())

    await user.click(screen.getByRole('checkbox', { name: '肉じゃが' }))
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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))
    await waitFor(() => expect(screen.getByText('この週の献立はまだありません')).toBeInTheDocument())
    const candidates = screen.getByRole('group', { name: 'レシピ候補' })
    const options = () => within(candidates).queryAllByRole('checkbox').map(radio => radio.getAttribute('value'))
    expect(options()).toEqual(['10', '11', '12'])

    await user.type(screen.getByLabelText('レシピを検索'), '唐揚')
    expect(options()).toEqual(['11'])
    expect(screen.getByRole('checkbox', { name: '鶏の唐揚げ' })).toBeVisible()
    await user.clear(screen.getByLabelText('レシピを検索'))
    await user.type(screen.getByLabelText('レシピを検索'), 'ＰＡＳＴＡ')
    expect(options()).toEqual(['12'])
    await user.click(screen.getByRole('checkbox', { name: 'Pasta Carbonara' }))
    await user.type(screen.getByLabelText('レシピを検索'), 'x')
    expect(options()).toEqual([])
    expect(within(candidates).getByText('該当するレシピがありません')).toBeVisible()
    await user.clear(screen.getByLabelText('レシピを検索'))
    expect(options()).toHaveLength(3)
    expect(screen.getByRole('checkbox', { name: 'Pasta Carbonara' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Pasta Carbonara' }))
    await user.click(screen.getByRole('checkbox', { name: '鶏の唐揚げ' }))
    await user.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ weekStartDate: monday, recipeId: 11 }))
  })

  it.each([['からあげ', 'カラアゲ'], ['カラアゲ', 'からあげ']])('タイトル%sを%sで即座に検索できる', async (title, keyword) => {
    setupApi({ recipes: [{ id: 10, title, ingredients: null, steps: null, sourceType: 'web', url: 'https://www.youtube.com/watch?v=example', thumbnailUrl: null, memo: null, isFavorite: false }] })
    const user = userEvent.setup()
    renderMenuPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))
    const search = await screen.findByRole('searchbox', { name: 'レシピを検索' })
    await user.type(search, keyword)
    expect(screen.getByRole('checkbox', { name: title })).toBeVisible()
    await user.type(search, '該当なし')
    expect(screen.queryByRole('checkbox', { name: title })).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByRole('checkbox', { name: title })).toBeVisible()
  })

  it('自由メモでラフ登録できる', async () => {
    const monday = getMondayOf(new Date())
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderMenuPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))
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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))
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
    await user.click(screen.getByRole('button', { name: '献立から削除' }))

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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'レシピを追加' }))

    const group = await screen.findByRole('group', { name: 'レシピ候補' })
    expect(within(group).getAllByRole('checkbox').map(radio => radio.getAttribute('value'))).toEqual(['2', '1'])
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

    await user.click(await screen.findByRole('button', { name: '[E2E_TEST] 動画レシピ' }))
    const link = screen.getByRole('link', { name: 'レシピを見る' })
    expect(link).toHaveAttribute('href', 'https://recipe.example.com/video')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(screen.getByRole('button', { name: '[E2E_TEST] 手入力レシピ' }))
    await user.click(screen.getByRole('button', { name: 'レシピを見る' }))
    const dialog = screen.getByRole('dialog', { name: 'レシピ詳細' })
    expect(dialog).toHaveTextContent('じゃがいも')
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()

    expect(screen.queryByRole('link', { name: '外食' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '外食' }))
    expect(screen.getAllByRole('button', { name: 'レシピを見る' })).toHaveLength(1)
  })
})

const recipe = (id: number, title = '[E2E_TEST] レシピ' + id): Recipe => ({
  id, title, ingredients: '材料', steps: null, sourceType: 'manual', url: null,
  thumbnailUrl: null, memo: null, isFavorite: false,
})

async function openSheet(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: 'レシピを追加' }))
  return screen.getByRole('dialog', { name: 'レシピを追加' })
}

describe('#419 献立の追加シート', () => {
  it('追加は一覧より前にあり、閉じて再表示しても選択とメモを保持する', async () => {
    setupApi({ recipes: [recipe(1), recipe(2)] })
    const user = userEvent.setup()
    renderMenuPage()
    const trigger = await screen.findByRole('button', { name: 'レシピを追加' })
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(trigger.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const sheet = await openSheet(user)
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
    await user.type(within(sheet).getByRole('searchbox'), '該当なし')
    expect(within(sheet).getByText('選択中: 1件（検索外の選択を含む）')).toBeVisible()
    await user.click(within(sheet).getByLabelText('自由メモ', { exact: true }))
    await user.type(within(sheet).getByLabelText('自由メモの内容'), '[[E2E_TEST] メモ')
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await openSheet(user)
    expect(screen.getByLabelText('自由メモの内容')).toHaveValue('[E2E_TEST] メモ')
    await user.click(screen.getByLabelText('レシピから選ぶ'))
    await user.clear(screen.getByRole('searchbox'))
    expect(screen.getByRole('checkbox', { name: recipe(1).title })).toBeChecked()
  })

  it('選択順で複数件を確定し、候補タイトル展開では選択・送信しない', async () => {
    const { calls } = setupApi({ recipes: [recipe(1), recipe(2)] })
    const user = userEvent.setup()
    renderMenuPage()
    const sheet = await openSheet(user)
    const title = within(sheet).getByRole('button', { name: recipe(1).title })
    expect(title).toHaveAttribute('aria-expanded', 'false')
    await user.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getByRole('checkbox', { name: recipe(1).title })).not.toBeChecked()
    await user.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'false')
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(2).title }))
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
    await user.dblClick(within(sheet).getByRole('button', { name: '追加' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'レシピを追加' })).not.toBeInTheDocument())
    expect(calls.filter(c => c.method === 'POST').map(c => (c.body as {recipeId:number}).recipeId)).toEqual([2, 1])
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('途中成功は再送せず、明示400拒否と未送信だけを再試行する', async () => {
    const { calls, state } = setupApi({ recipes: [recipe(1), recipe(2), recipe(3)] })
    let fail = true
    let nextId = 50
    const posted: number[] = []
    server.use(http.post('/api/menu-entries', async ({ request }) => {
      const body = await request.json() as { recipeId:number; weekStartDate:string }
      posted.push(body.recipeId)
      if (body.recipeId === 2 && fail) return HttpResponse.json({ message: '入力内容を確認してください' }, { status: 400 })
      const entry = { id: nextId++, recipeId: body.recipeId, recipeTitle: recipe(body.recipeId).title, freeTextMemo: null, weekStartDate: body.weekStartDate }
      state.entries[body.weekStartDate] = [...(state.entries[body.weekStartDate] ?? []), entry]
      return HttpResponse.json(entry, { status: 201 })
    }))
    const user = userEvent.setup()
    renderMenuPage()
    const sheet = await openSheet(user)
    for (const item of [1, 2, 3]) await user.click(within(sheet).getByRole('checkbox', { name: recipe(item).title }))
    await user.click(within(sheet).getByRole('button', { name: '追加' }))
    await within(sheet).findByRole('alert')
    expect(posted).toEqual([1, 2])
    expect(within(sheet).getByRole('checkbox', { name: recipe(1).title })).not.toBeChecked()
    expect(within(sheet).getByRole('checkbox', { name: recipe(2).title })).toBeChecked()
    expect(within(sheet).getByRole('checkbox', { name: recipe(3).title })).toBeChecked()
    fail = false
    await user.click(within(sheet).getByRole('button', { name: '追加' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'レシピを追加' })).not.toBeInTheDocument())
    expect(posted).toEqual([1, 2, 2, 3])
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0)
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3)
  })

  it('送信中は閉じると再送を防ぎ、成功後の再取得失敗を保存失敗にしない', async () => {
    const { calls } = setupApi({ recipes: [recipe(1)] })
    let release!: () => void
    server.use(http.post('/api/menu-entries', async () => {
      await new Promise<void>(resolve => { release = resolve })
      return HttpResponse.json({ id: 50, recipeId: 1, recipeTitle: recipe(1).title, freeTextMemo: null, weekStartDate: getMondayOf(new Date()) }, { status: 201 })
    }))
    const user = userEvent.setup()
    renderMenuPage()
    const sheet = await openSheet(user)
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
    await user.click(within(sheet).getByRole('button', { name: '追加' }))
    await waitFor(() => expect(release).toBeDefined())
    await user.keyboard('{Escape}')
    expect(sheet).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: '閉じる' })).toBeDisabled()
    server.use(http.get('/api/menu-entries', () => HttpResponse.json({}, { status: 500 })))
    release()
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    expect(await screen.findByText('献立は追加済みですが、一覧の取得に失敗しました')).toBeVisible()
    await openSheet(user)
    expect(screen.getByRole('checkbox', { name: recipe(1).title })).not.toBeChecked()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })

  it('登録済みタイトルとサイト名を別行に表示し、確認取消では削除しない', async () => {
    const monday = getMondayOf(new Date())
    const web = { ...recipe(1, '[E2E_TEST] 長いタイトル'.repeat(8)), sourceType: 'web', url: 'https://recipe.example.com/1' }
    const { calls } = setupApi({ recipes: [web], entries: { [monday]: [{ id: 1, recipeId: 1, recipeTitle: web.title, freeTextMemo: null, weekStartDate: monday }] } })
    const user = userEvent.setup()
    renderMenuPage()
    const title = await screen.findByRole('button', { name: web.title })
    expect(title).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('recipe.example.com')).not.toBe(title)
    await user.click(title)
    expect(screen.getByRole('link', { name: 'レシピを見る' })).toHaveAttribute('target', '_blank')
    await user.click(screen.getByRole('button', { name: '削除' }))
    const confirmation = screen.getByRole('dialog', { name: '献立を削除' })
    expect(confirmation).toHaveTextContent('レシピ原本は削除されません')
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0)
    await user.click(within(confirmation).getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('button', { name: '削除' })).toHaveFocus()
    expect(title).toBeInTheDocument()
  })
})

describe('#419 非同期境界', () => {
  it.each([0, 500])('結果不明の追加(%s)は閉じて再表示しても停止理由を保持し、再送しない', async status => {
    const { state } = setupApi({ recipes: [recipe(1)] })
    let attempts = 0
    server.use(http.post('/api/menu-entries', async ({ request }) => {
      attempts++
      const body = await request.json() as { weekStartDate: string }
      // 保存後に応答が失敗したケース。安全な再送可否を画面側で判断できない。
      state.entries[body.weekStartDate] = [...(state.entries[body.weekStartDate] ?? []), { id: attempts, recipeId: 1, recipeTitle: recipe(1).title, freeTextMemo: null, weekStartDate: body.weekStartDate }]
      return status === 0 ? HttpResponse.error() : HttpResponse.json({ message: '結果不明' }, { status })
    }))
    const user = userEvent.setup()
    renderMenuPage()
    const sheet = await openSheet(user)
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
    await user.click(within(sheet).getByRole('button', { name: '追加' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('追加結果を確認できません')
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '閉じる' })).toBeEnabled())
    await user.click(within(sheet).getByRole('button', { name: '閉じる' }))
    expect(await within(screen.getByRole('list')).findByRole('button', { name: recipe(1).title })).toBeVisible()
    const reopened = await openSheet(user)
    expect(within(reopened).getByRole('alert')).toHaveTextContent('追加結果を確認できません')
    expect(within(reopened).getByRole('button', { name: '追加' })).toBeDisabled()
    expect(attempts).toBe(1)
    expect(state.entries[getMondayOf(new Date())]).toHaveLength(1)
  })

  it('追加結果不明の一覧GETも失敗したら未更新を明示し、閉じて再表示しても再送しない', async () => {
    const { state } = setupApi({ recipes: [recipe(1)] })
    let attempts = 0
    let confirmationReads = 0
    server.use(http.post('/api/menu-entries', async ({ request }) => {
      attempts++
      const body = await request.json() as { weekStartDate: string }
      state.entries[body.weekStartDate] = [{ id: 99, recipeId: 1, recipeTitle: recipe(1).title, freeTextMemo: null, weekStartDate: body.weekStartDate }]
      server.use(http.get('/api/menu-entries', () => {
        confirmationReads++
        return HttpResponse.json({ message: '[E2E_TEST] 一覧取得失敗' }, { status: 500 })
      }))
      return HttpResponse.json({ message: '追加結果不明' }, { status: 500 })
    }))
    const user = userEvent.setup()
    renderMenuPage()
    const sheet = await openSheet(user)
    await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
    await user.click(within(sheet).getByRole('button', { name: '追加' }))
    await waitFor(() => expect(within(sheet).getByRole('alert')).toHaveTextContent('一覧を更新できませんでした'))
    expect(within(sheet).getByRole('button', { name: '追加' })).toBeDisabled()
    expect(confirmationReads).toBe(1)
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '閉じる' })).toBeEnabled())
    await user.click(within(sheet).getByRole('button', { name: '閉じる' }))
    const reopened = await openSheet(user)
    expect(within(reopened).getByRole('alert')).toHaveTextContent('一覧を更新できませんでした')
    expect(within(reopened).getByRole('button', { name: '追加' })).toBeDisabled()
    expect(attempts).toBe(1)
  })

  it('週移動後に戻った古いGETは現在週を上書きせず、abortを取得失敗にしない', async () => {
    const monday = getMondayOf(new Date())
    const next = addWeeks(monday, 1)
    let release!: () => void
    let nextRequested = false
    server.use(http.get('/api/recipes', () => HttpResponse.json([])))
    server.use(http.get('/api/menu-entries', async ({ request }) => {
      const week = new URL(request.url).searchParams.get('weekStartDate')!
      if (week === monday) await new Promise<void>(resolve => { release = resolve })
      else nextRequested = true
      return HttpResponse.json([{ id: 1, recipeId: null, recipeTitle: null, freeTextMemo: week, weekStartDate: week }])
    }))
    const user = userEvent.setup()
    renderMenuPage()
    await waitFor(() => expect(release).toBeDefined())
    await user.click(screen.getByRole('button', { name: '次週' }))
    await waitFor(() => expect(nextRequested).toBe(true))
    await screen.findByRole('button', { name: next })
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: next })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: monday })).not.toBeInTheDocument()
    expect(screen.queryByText(/献立の取得に失敗しました/)).not.toBeInTheDocument()
  })

  it('正規API取得失敗は空成功に隠さず通知する', async () => {
    setupApi()
    server.use(http.get('/api/menu-entries', () => HttpResponse.json({ message: '取得できません' }, { status: 500 })))
    renderMenuPage()
    expect(await screen.findByText('取得できません')).toBeVisible()
  })
})

describe('#419 StrictModeの起点復帰', () => {
  it.each(['閉じる', 'Escape', '追加'])('%sでシートを閉じると上部起点へ復帰する', async action => {
    setupApi({ recipes: [recipe(1)] })
    const user = userEvent.setup()
    render(<StrictMode><MemoryRouter><MenuPage /></MemoryRouter></StrictMode>)
    const trigger = await screen.findByRole('button', { name: 'レシピを追加' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'レシピを追加' })
    if (action === 'Escape') await user.keyboard('{Escape}')
    else {
      if (action === '追加') await user.click(within(sheet).getByRole('checkbox', { name: recipe(1).title }))
      await user.click(within(sheet).getByRole('button', { name: action }))
    }
    await waitFor(() => expect(sheet).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
