import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('URL登録で409ならモーダル内にサーバーのエラーを表示しURLとメモを保持する', async () => {
    setupApi()
    server.use(http.post('/api/recipes/from-url', () => HttpResponse.json({
      code: 'DUPLICATE_RECIPE_URL',
      message: 'このURLのレシピは既に登録されています',
    }, { status: 409 })))
    const user = userEvent.setup()
    renderRecipesPage()
    await user.click(await screen.findByRole('button', { name: 'レシピを登録' }))
    await user.click(screen.getByRole('tab', { name: 'WEB' }))
    await user.type(screen.getByLabelText('レシピURL'), 'https://example.com/recipe')
    await user.type(screen.getByLabelText('メモ'), '[[E2E_TEST] 残すメモ')
    await user.click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('このURLのレシピは既に登録されています')
    expect(screen.getByRole('heading', { name: 'レシピを登録' })).toBeVisible()
    expect(screen.getByLabelText('レシピURL')).toHaveValue('https://example.com/recipe')
    expect(screen.getByLabelText('メモ')).toHaveValue('[E2E_TEST] 残すメモ')
    expect(screen.getByRole('button', { name: '登録' })).toBeEnabled()
    expect(screen.queryByText('レシピを登録しました')).not.toBeInTheDocument()
  })

  it('PC案内の下にiPhone手順への入口を表示する', async () => {
    const { calls } = setupApi()
    renderRecipesPage()
    const iphone = await screen.findByRole('heading', { name: 'iPhoneからレシピを登録' })
    const pc = screen.getByRole('heading', { name: 'PCからレシピを登録' })
    expect(pc.compareDocumentPosition(iphone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ショートカットを追加する' })).toHaveAttribute('href', '/recipes/iphone-shortcut')
    expect(calls).toEqual([])
  })
  it('一覧にPCから登録する案内を表示する', async () => {
    setupApi()
    renderRecipesPage()
    expect(await screen.findByRole('link', { name: 'シェファミに登録' })).toBeInTheDocument()
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

  // Androidの共有では、URLが url ではなく text に入り、url は空で届くことがある(#520)。
  it.each([
    ['urlが空の', `url=&text=${encodeURIComponent('https://recipe.example.com/android')}`],
    ['urlが空白だけの', `url=${encodeURIComponent('  ')}&text=${encodeURIComponent('https://recipe.example.com/android')}`],
    ['urlが空で、textにURL以外の文字もある', `title=&text=${encodeURIComponent('[E2E_TEST] おいしい肉じゃが https://recipe.example.com/android')}&url=`],
  ])('%sときは、textのURLで登録画面を開く', async (_label, query) => {
    const { calls } = setupApi()
    renderRecipesPage(`/recipes/share?${query}`)
    expect(await screen.findByLabelText('レシピURL')).toHaveValue('https://recipe.example.com/android')
    expect(screen.getByRole('tab', { name: 'WEB', selected: true })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('urlに値があるときは、textよりurlを優先する', async () => {
    setupApi()
    renderRecipesPage(`/recipes/share?url=${encodeURIComponent('https://recipe.example.com/url')}&text=${encodeURIComponent('https://recipe.example.com/text')}`)
    expect(await screen.findByLabelText('レシピURL')).toHaveValue('https://recipe.example.com/url')
  })

  it('urlが空で、textにもURLが無いときは、登録画面を開かない', async () => {
    setupApi()
    renderRecipesPage(`/recipes/share?url=&text=${encodeURIComponent('[E2E_TEST] URLのない文章')}`)
    expect(await screen.findByText('レシピはありません')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'レシピを登録' })).not.toBeInTheDocument()
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

  it.each([
    ['材料', '手順'],
    ['手順', '材料'],
  ])('%sが10,000文字を超えるとクライアント側でエラー表示しAPIを呼ばない (#513)', async (longField, otherField) => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderRecipesPage()
    await waitFor(() => expect(screen.getByText('レシピはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'レシピを登録' }))
    await user.type(screen.getByLabelText('タイトル'), '[E2E_TEST] 長いレシピ')
    // 入力欄の上限(maxLength)は手入力だけを止める。画像解析の結果や貼り付けで超えた場合を想定し、値を直接入れる。
    expect(screen.getByLabelText(longField)).toHaveAttribute('maxlength', '10000')
    fireEvent.change(screen.getByLabelText(longField), { target: { value: 'あ'.repeat(10_001) } })
    fireEvent.change(screen.getByLabelText(otherField), { target: { value: 'い'.repeat(10_000) } })
    await user.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByText('材料と手順は、それぞれ10,000文字以内で入力してください')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/recipes')).toBe(false)

    // 上限ちょうどに直すと登録できる(境界値)。
    fireEvent.change(screen.getByLabelText(longField), { target: { value: 'あ'.repeat(10_000) } })
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/recipes')).toBe(true))
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

describe('レシピ一覧の見た目に関わる構成 (#489)', () => {
  const recipe = (id: number, title: string, isFavorite = false): Recipe => ({ id, title, ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite })

  it('補足・全幅の登録・件数つきの見出しを表示し、1件を1つのリスト項目にする', async () => {
    setupApi({ recipes: [recipe(1, '[E2E_TEST] 肉じゃが', true), recipe(2, '[E2E_TEST] カレー')] })
    renderRecipesPage()
    const panel = await screen.findByTestId('recipes-panel')
    expect(within(panel).getByRole('heading', { level: 2, name: 'レシピ一覧' })).toBeInTheDocument()
    expect(within(panel).getByText('タイトルを押すと材料と手順を確認できます')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'レシピを登録' })).toHaveClass('ui-action')
    expect(within(panel).getByRole('heading', { level: 3, name: '登録済みのレシピ（2件）' })).toBeInTheDocument()
    const items = within(within(panel).getByRole('list', { name: 'レシピ' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('ui-card', 'recipe-list-item')
    // 行のボタン名はタイトルのまま。お気に入りは行のボタンの外に置き、文言を変えない。
    const row = within(items[0]).getByRole('button', { name: '[E2E_TEST] 肉じゃが' })
    const favorite = within(items[0]).getByRole('button', { name: '★ お気に入り' })
    expect(favorite).toHaveAttribute('aria-pressed', 'true')
    // 見た目は星だけ。読み上げ用の名前は従来の文言のまま。
    expect(favorite).toHaveTextContent(/^★$/)
    expect(row).not.toContainElement(favorite)
    expect(within(items[1]).getByRole('button', { name: '☆ お気に入りにする' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('0件のときは見出しと一覧を出さず、案内だけを表示する', async () => {
    setupApi()
    renderRecipesPage()
    const panel = await screen.findByTestId('recipes-panel')
    expect(within(panel).getByText('レシピはありません')).toHaveClass('ui-empty')
    expect(within(panel).queryByRole('heading', { level: 3, name: /登録済みのレシピ/ })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('list', { name: 'レシピ' })).not.toBeInTheDocument()
  })

  it('PC・iPhoneの案内を「ほかの登録方法」の下に、同じ幅のカードで表示する', async () => {
    setupApi()
    renderRecipesPage()
    const panel = await screen.findByTestId('recipes-panel')
    const label = within(panel).getByText('ほかの登録方法')
    const pc = within(panel).getByRole('region', { name: 'PCからレシピを登録' })
    const iphone = within(panel).getByRole('region', { name: 'iPhoneからレシピを登録' })
    expect(pc).toHaveClass('ui-card')
    expect(iphone).toHaveClass('ui-card')
    expect(label.compareDocumentPosition(pc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pc.compareDocumentPosition(iphone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(pc).getByRole('link', { name: 'シェファミに登録' })).toBeInTheDocument()
    expect(within(iphone).getByRole('link', { name: 'ショートカットを追加する' })).toHaveAttribute('href', '/recipes/iphone-shortcut')
  })

  it('iPhoneの案内の下に、Androidの共有メニューから登録する案内を同じ形のカードで表示する (#520)', async () => {
    const { calls } = setupApi()
    renderRecipesPage()
    const panel = await screen.findByTestId('recipes-panel')
    const iphone = within(panel).getByRole('region', { name: 'iPhoneからレシピを登録' })
    const android = within(panel).getByRole('region', { name: 'Androidからレシピを登録' })
    expect(android).toHaveClass('ui-card', 'recipe-guide')
    expect(iphone.compareDocumentPosition(android) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const steps = within(android).getAllByRole('listitem').map((item) => item.textContent)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toContain('Chrome')
    expect(steps[0]).toContain('インストール')
    expect(steps[1]).toContain('共有')
    expect(steps[1]).toContain('「シェファミ」')
    expect(steps[2]).toContain('「登録」')
    // 使えないときの代わりの方法も案内する。
    expect(android).toHaveTextContent('WEBタブにURLを貼り付けて')
    expect(calls).toEqual([])
  })
})

describe('レシピ一覧の「すべて／お気に入り」の切り替え (#495)', () => {
  const recipe = (id: number, title: string, isFavorite = false): Recipe => ({ id, title, ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite })
  const titles = () => within(screen.getByRole('list', { name: 'レシピ' })).getAllByRole('listitem').map((item) => within(item).getAllByRole('button')[0].textContent)

  it('最初は「すべて」が選ばれ、「お気に入り」で星を付けたレシピだけを件数つきの見出しで表示する', async () => {
    setupApi({ recipes: [recipe(1, '[E2E_TEST] 肉じゃが', true), recipe(2, '[E2E_TEST] カレー'), recipe(3, '[E2E_TEST] 親子丼', true)] })
    const user = userEvent.setup()
    renderRecipesPage()
    const panel = await screen.findByTestId('recipes-panel')
    const filter = within(panel).getByRole('group', { name: '表示するレシピ' })
    const all = within(filter).getByRole('radio', { name: 'すべて' })
    const favorites = within(filter).getByRole('radio', { name: 'お気に入り' })
    expect(all).toBeChecked()
    expect(favorites).not.toBeChecked()
    expect(titles()).toEqual(['[E2E_TEST] 肉じゃが', '[E2E_TEST] カレー', '[E2E_TEST] 親子丼'])
    await user.click(favorites)
    expect(favorites).toBeChecked()
    expect(screen.getByRole('heading', { level: 3, name: 'お気に入りのレシピ（2件）' })).toBeInTheDocument()
    expect(titles()).toEqual(['[E2E_TEST] 肉じゃが', '[E2E_TEST] 親子丼'])
    await user.click(all)
    expect(screen.getByRole('heading', { level: 3, name: '登録済みのレシピ（3件）' })).toBeInTheDocument()
    expect(titles()).toHaveLength(3)
  })

  it('お気に入りが0件のときは、案内と星の付け方を表示する', async () => {
    setupApi({ recipes: [recipe(1, '[E2E_TEST] 肉じゃが')] })
    const user = userEvent.setup()
    renderRecipesPage()
    await user.click(await screen.findByRole('radio', { name: 'お気に入り' }))
    expect(screen.getByText('お気に入りのレシピはありません')).toBeInTheDocument()
    expect(screen.getByText(/「すべて」で星（☆）を押すと/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'レシピ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: /のレシピ（/ })).not.toBeInTheDocument()
  })

  it('「お気に入り」を表示中に星を外すと一覧から消え、フォーカスを切り替えへ移す', async () => {
    const { calls } = setupApi({ recipes: [recipe(1, '[E2E_TEST] 肉じゃが', true), recipe(2, '[E2E_TEST] 親子丼', true)] })
    const user = userEvent.setup()
    renderRecipesPage()
    const favorites = await screen.findByRole('radio', { name: 'お気に入り' })
    await user.click(favorites)
    const first = within(screen.getByRole('list', { name: 'レシピ' })).getAllByRole('listitem')[0]
    await user.click(within(first).getByRole('button', { name: '★ お気に入り' }))
    await waitFor(() => expect(titles()).toEqual(['[E2E_TEST] 親子丼']))
    expect(screen.getByRole('heading', { level: 3, name: 'お気に入りのレシピ（1件）' })).toBeInTheDocument()
    expect(favorites).toHaveFocus()
    expect(calls.find((call) => call.method === 'PATCH' && call.url === '/api/recipes/1/favorite')?.body).toMatchObject({ isFavorite: false })
    // 「すべて」に戻すと、星を外したレシピは残っている。
    await user.click(screen.getByRole('radio', { name: 'すべて' }))
    expect(titles()).toEqual(['[E2E_TEST] 肉じゃが', '[E2E_TEST] 親子丼'])
  })

  it('「すべて」を表示中に星を付け外ししても、一覧からは消えずフォーカスも動かない', async () => {
    setupApi({ recipes: [recipe(1, '[E2E_TEST] 肉じゃが', true)] })
    const user = userEvent.setup()
    renderRecipesPage()
    const star = await screen.findByRole('button', { name: '★ お気に入り' })
    await user.click(star)
    const off = await screen.findByRole('button', { name: '☆ お気に入りにする' })
    expect(off).toHaveFocus()
    expect(titles()).toEqual(['[E2E_TEST] 肉じゃが'])
  })

  it('レシピが1件も無いときは切り替えを出さない', async () => {
    setupApi()
    renderRecipesPage()
    await screen.findByText('レシピはありません')
    expect(screen.queryByRole('group', { name: '表示するレシピ' })).not.toBeInTheDocument()
  })
})
