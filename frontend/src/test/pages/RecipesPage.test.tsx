import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { RecipesPage } from '../../pages/RecipesPage'
import type { Recipe } from '../../api/kondateTypes'

function setupApi(initial: { recipes?: Recipe[] } = {}) {
  const state = { recipes: initial.recipes ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/recipes', () => HttpResponse.json(state.recipes)),
    http.post('/api/recipes', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/recipes', body })
      const recipe: Recipe = {
        id: nextId++,
        title: body.title as string,
        ingredients: (body.ingredients as string | null) ?? null,
        steps: (body.steps as string | null) ?? null,
        sourceType: 'manual',
        url: null,
        thumbnailUrl: null,
        memo: null,
        isFavorite: false,
      }
      state.recipes.push(recipe)
      return HttpResponse.json(recipe, { status: 201 })
    }),
    http.post('/api/recipes/from-url', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/recipes/from-url', body })
      const recipe: Recipe = {
        id: nextId++,
        title: 'WEBレシピタイトル',
        ingredients: null,
        steps: null,
        sourceType: 'web',
        url: body.url as string,
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
        memo: (body.memo as string | null) ?? null,
        isFavorite: false,
      }
      state.recipes.push(recipe)
      return HttpResponse.json(recipe, { status: 201 })
    }),
    http.patch('/api/recipes/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/recipes/${params.id}`, body })
      const target = state.recipes.find((r) => r.id === Number(params.id))
      if (target) {
        if (target.sourceType === 'web') {
          target.memo = (body.memo as string | null) ?? null
        } else {
          target.title = body.title as string
          target.ingredients = (body.ingredients as string | null) ?? null
          target.steps = (body.steps as string | null) ?? null
        }
      }
      return HttpResponse.json(target)
    }),
    http.patch('/api/recipes/:id/favorite', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/recipes/${params.id}/favorite`, body })
      const target = state.recipes.find((r) => r.id === Number(params.id))
      if (target) {
        target.isFavorite = body.isFavorite as boolean
      }
      return HttpResponse.json(target)
    }),
    http.delete('/api/recipes/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/recipes/${params.id}` })
      state.recipes = state.recipes.filter((r) => r.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderRecipesPage(initialPath = '/recipes') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RecipesPage />
    </MemoryRouter>,
  )
}

describe('RecipesPage', () => {
  it('PC案内の下にiPhone手順への入口を表示する', async () => {
    const { calls } = setupApi()
    renderRecipesPage()
    const iphone = await screen.findByRole('heading', { name: 'iPhoneからレシピを登録' })
    const pc = screen.getByRole('heading', { name: 'PCからレシピを登録' })
    expect(pc.compareDocumentPosition(iphone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ショートカットの作り方' })).toHaveAttribute('href', '/recipes/iphone-shortcut')
    expect(calls).toEqual([])
  })
  it('一覧にPCから登録する案内を表示する', async () => {
    setupApi()
    renderRecipesPage()
    expect(await screen.findByRole('link', { name: 'HomeLogに登録' })).toBeInTheDocument()
  })

  it('複雑な共有URLを明示的な登録操作まで保存せず、そのままPOSTする', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    const url = `https://recipe.example.com/日本語?q=a&eq=x=y&plus=+&pct=%25&quote="'#手順`
    renderRecipesPage(`/recipes/share?url=${encodeURIComponent(url)}`)
    expect(await screen.findByLabelText('レシピURL')).toHaveValue(url)
    expect(screen.getByRole('tab', { name: 'WEB', selected: true })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '登録' }))
    await screen.findByText('WEBレシピタイトル')
    expect(calls.find((c) => c.url === '/api/recipes/from-url')?.body).toEqual({ url, memo: null })
  })

  it('text共有のURLフォールバックを維持する', async () => {
    setupApi()
    renderRecipesPage(`/recipes/share?text=${encodeURIComponent('[E2E_TEST] https://recipe.example.com/text?q=1&b=2#steps')}`)
    expect(await screen.findByLabelText('レシピURL')).toHaveValue('https://recipe.example.com/text?q=1&b=2#steps')
  })
  it('レシピがない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderRecipesPage()

    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())
  })

  it('レシピ一覧が表示される', async () => {
    setupApi({
      recipes: [{ id: 1, title: '肉じゃが', ingredients: '牛肉・じゃがいも', steps: '煮込む', sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }],
    })
    renderRecipesPage()

    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeInTheDocument())
    // 一覧にはタイトルだけを表示し、材料・手順は出さない
    expect(screen.queryByText('牛肉・じゃがいも')).not.toBeInTheDocument()
    expect(screen.queryByText('煮込む')).not.toBeInTheDocument()
  })

  it('タイトルを押すと材料・手順の詳細モーダルが開く', async () => {
    setupApi({
      recipes: [{ id: 1, title: '肉じゃが', ingredients: '牛肉・じゃがいも', steps: '煮込む', sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }],
    })
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '肉じゃが' }))

    const dialog = screen.getByRole('dialog', { name: 'レシピ詳細' })
    expect(within(dialog).getByText('牛肉・じゃがいも')).toBeInTheDocument()
    expect(within(dialog).getByText('煮込む')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
  })

  it('レシピを登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    await user.type(screen.getByLabelText('タイトル'), 'カレー')
    await user.type(screen.getByLabelText('材料'), 'じゃがいも・にんじん')
    await user.type(screen.getByLabelText('手順'), '煮込んでルーを入れる')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('カレー')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'レシピを登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/recipes')
    expect(postCall?.body).toMatchObject({ title: 'カレー', ingredients: 'じゃがいも・にんじん', steps: '煮込んでルーを入れる' })
  })

  it('材料・手順を省略して登録できる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    await user.type(screen.getByLabelText('タイトル'), 'トースト')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('トースト')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/recipes')
    expect(postCall?.body).toMatchObject({ title: 'トースト', ingredients: null, steps: null })
  })

  it('タイトルが空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('タイトルは1〜100文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/recipes')).toBe(false)
  })

  it('レシピを編集すると一覧に反映される', async () => {
    const { calls } = setupApi({
      recipes: [{ id: 1, title: '肉じゃが', ingredients: '牛肉', steps: '煮る', sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }],
    })
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeInTheDocument())

    // 編集は詳細モーダルから行う
    await user.click(screen.getByRole('button', { name: '肉じゃが' }))
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'レシピを編集' })).toBeInTheDocument()
    const titleInput = screen.getByLabelText('タイトル')
    await user.clear(titleInput)
    await user.type(titleInput, '肉じゃが(改)')
    await user.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getByText('肉じゃが(改)')).toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/recipes/1')
    expect(patchCall?.body).toMatchObject({ title: '肉じゃが(改)' })
  })

  it('レシピを削除すると一覧から消える', async () => {
    const { calls } = setupApi({
      recipes: [{ id: 1, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }],
    })
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('肉じゃが')).toBeInTheDocument())

    // 削除は詳細モーダルから行う
    await user.click(screen.getByRole('button', { name: '肉じゃが' }))
    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'レシピを削除しますか？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/recipes/1')).toBe(true)
  })

  it('お気に入りボタンでON/OFFを切り替えられる', async () => {
    const { calls } = setupApi({
      recipes: [{ id: 1, title: '肉じゃが', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }],
    })
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByRole('button', { name: '☆ お気に入りにする' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '☆ お気に入りにする' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '★ お気に入り' })).toBeInTheDocument())
    const favoriteCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/recipes/1/favorite')
    expect(favoriteCall?.body).toMatchObject({ isFavorite: true })
  })

  it('キャンセルボタンでレシピ登録モーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    expect(screen.getByRole('heading', { name: 'レシピを登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('heading', { name: 'レシピを登録' })).not.toBeInTheDocument()
  })

  it('API失敗時はトーストでエラーを表示する', async () => {
    server.use(
      http.get('/api/recipes', () => HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'レシピの取得に失敗しました' }, { status: 500 })),
    )
    renderRecipesPage()

    await waitFor(() => expect(screen.getByText('レシピの取得に失敗しました')).toBeInTheDocument())
  })

  it('WEBタブからURLを入力してレシピを登録できる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    await user.click(screen.getByRole('tab', { name: 'WEB' }))
    await user.type(screen.getByLabelText('レシピURL'), 'https://recipe.example.com/123')
    await user.type(screen.getByLabelText('メモ'), '来週作る')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('WEBレシピタイトル')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/recipes/from-url')
    expect(postCall?.body).toMatchObject({ url: 'https://recipe.example.com/123', memo: '来週作る' })
    // 一覧はタイトルのみで、元ページへのリンクは詳細モーダルに表示する。
    expect(screen.queryByRole('link', { name: '元ページを開く' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'WEBレシピタイトル' }))
    expect(screen.getByRole('link', { name: '元ページを開く' })).toBeInTheDocument()
  })

  it('WEBレシピの編集ではmemoのみ変更できる', async () => {
    const { calls } = setupApi({
      recipes: [
        {
          id: 1,
          title: 'クラシルの肉じゃが',
          ingredients: null,
          steps: null,
          sourceType: 'web',
          url: 'https://recipe.example.com/1',
          thumbnailUrl: 'https://cdn.example.com/thumb.png',
          memo: '元メモ',
          isFavorite: false,
        },
      ],
    })
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('クラシルの肉じゃが')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'クラシルの肉じゃが' }))
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('heading', { name: 'WEBレシピを編集' })).toBeInTheDocument()
    // タイトルは読み取り専用表示のため入力欄としては存在しない。
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument()
    const memoInput = screen.getByLabelText('メモ')
    await user.clear(memoInput)
    await user.type(memoInput, '更新後メモ')
    await user.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'WEBレシピを編集' })).not.toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/recipes/1')
    expect(patchCall?.body).toEqual({ memo: '更新後メモ' })
  })

  it('/recipes/share?url=...でアクセスするとWEBタブが選択された登録モーダルが自動的に開く', async () => {
    setupApi()
    renderRecipesPage('/recipes/share?url=https%3A%2F%2Frecipe.example.com%2Fshared')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'レシピを登録' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'WEB', selected: true })).toBeInTheDocument()
    expect(screen.getByLabelText('レシピURL')).toHaveValue('https://recipe.example.com/shared')
  })
})
