import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ userId: number; headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `CODE${user.id}00000000000`.slice(0, 16))
    .first<{ id: number }>()
  if (!household) throw new Error('test setup error')
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)')
    .bind(household.id, user.id)
    .run()
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function createUserWithoutHousehold(email: string): Promise<{ userId: number; headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト花子')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function joinHousehold(userId: number, headers: Record<string, string>, ownerHeaders: Record<string, string>): Promise<Record<string, string>> {
  const meRes = await app.request('/api/households/me', { headers: ownerHeaders }, env)
  const me = await meRes.json<{ inviteCode: string }>()
  const joinRes = await app.request(
    '/api/households/join',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inviteCode: me.inviteCode }) },
    env,
  )
  if (joinRes.status !== 200) throw new Error(`test setup error: join failed with status ${joinRes.status}`)
  return headers
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/recipes', () => {
  it('201でレシピを登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/recipes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ title: '肉じゃが', ingredients: '牛肉・じゃがいも・にんじん', steps: '煮込む' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ title: string; ingredients: string; steps: string; sourceType: string; isFavorite: boolean }>()
    expect(body.title).toBe('肉じゃが')
    expect(body.ingredients).toBe('牛肉・じゃがいも・にんじん')
    expect(body.steps).toBe('煮込む')
    expect(body.sourceType).toBe('manual')
    expect(body.isFavorite).toBe(false)
  })

  it('タイトル未入力の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: '  ' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('材料・手順を省略しても登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: 'カレー' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ ingredients: string | null; steps: string | null }>()
    expect(body.ingredients).toBeNull()
    expect(body.steps).toBeNull()
  })
})

describe('GET /api/recipes', () => {
  it('世帯メンバー全員に登録済みレシピが見える', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )

    const res = await app.request('/api/recipes', { headers: memberHeaders }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ title: string }[]>()
    expect(body.map((r) => r.title)).toEqual(['肉じゃが'])
  })

  it('他世帯のレシピは見えない', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('jiro@example.com')
    await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )

    const res = await app.request('/api/recipes', { headers: other.headers }, env)

    const body = await res.json<{ title: string }[]>()
    expect(body).toEqual([])
  })
})

describe('PATCH/DELETE /api/recipes/:id', () => {
  it('登録者以外の世帯メンバーも編集・削除できる', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const createRes = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )
    const recipe = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/recipes/${recipe.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ title: '肉じゃが(改)', ingredients: '牛肉', steps: '煮る' }) },
      env,
    )
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json<{ title: string }>()).title).toBe('肉じゃが(改)')

    const deleteRes = await app.request(`/api/recipes/${recipe.id}`, { method: 'DELETE', headers: memberHeaders }, env)
    expect(deleteRes.status).toBe(204)
  })

  it('他世帯のレシピを指定すると404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('jiro@example.com')
    const createRes = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )
    const recipe = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/recipes/${recipe.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ title: '改変' }) },
      env,
    )
    expect(patchRes.status).toBe(404)

    const deleteRes = await app.request(`/api/recipes/${recipe.id}`, { method: 'DELETE', headers: other.headers }, env)
    expect(deleteRes.status).toBe(404)
  })
})

describe('PATCH /api/recipes/:id/favorite', () => {
  it('お気に入りをON/OFFに切り替えられる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )
    const recipe = await createRes.json<{ id: number }>()

    const onRes = await app.request(
      `/api/recipes/${recipe.id}/favorite`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ isFavorite: true }) },
      env,
    )
    expect(onRes.status).toBe(200)
    expect((await onRes.json<{ isFavorite: boolean }>()).isFavorite).toBe(true)

    const offRes = await app.request(
      `/api/recipes/${recipe.id}/favorite`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ isFavorite: false }) },
      env,
    )
    expect(offRes.status).toBe(200)
    expect((await offRes.json<{ isFavorite: boolean }>()).isFavorite).toBe(false)
  })

  it('他世帯のレシピを指定すると404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('jiro@example.com')
    const createRes = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )
    const recipe = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/recipes/${recipe.id}/favorite`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ isFavorite: true }) },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('POST /api/recipes/from-url', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(response: Response) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  }

  function htmlResponse(html: string, contentType = 'text/html; charset=utf-8') {
    return new Response(html, { status: 200, headers: { 'content-type': contentType } })
  }

  it('og:titleとog:imageを抽出して201で保存できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    stubFetch(
      htmlResponse(
        '<html><head><meta property="og:title" content="肉じゃがレシピ"><meta property="og:image" content="https://cdn.example.com/img.png"><title>フォールバック</title></head></html>',
      ),
    )

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/123', memo: '来週作る' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ title: string; thumbnailUrl: string | null; memo: string | null; sourceType: string; url: string | null; ingredients: string | null; steps: string | null }>()
    expect(body.title).toBe('肉じゃがレシピ')
    expect(body.thumbnailUrl).toBe('https://cdn.example.com/img.png')
    expect(body.memo).toBe('来週作る')
    expect(body.sourceType).toBe('web')
    expect(body.url).toBe('https://recipe.example.com/123')
    expect(body.ingredients).toBeNull()
    expect(body.steps).toBeNull()
  })

  it('og:titleが無ければ<title>にフォールバックする', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    stubFetch(htmlResponse('<html><head><title>タイトルタグのみ</title></head></html>'))

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/456' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ title: string; thumbnailUrl: string | null }>()
    expect(body.title).toBe('タイトルタグのみ')
    expect(body.thumbnailUrl).toBeNull()
  })

  it('og:titleも<title>も無ければURL文字列にフォールバックする', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    stubFetch(htmlResponse('<html><head></head><body>本文のみ</body></html>'))

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/789' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ title: string }>()
    expect(body.title).toBe('https://recipe.example.com/789')
  })

  it('http/https以外のスキームは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'ftp://recipe.example.com/1' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('不正なURL形式は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'not-a-url' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it.each([
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://127.255.255.254/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::]/x',
    'http://[::1]/x',
    'http://[fc00::1]/x',
    'http://[fdff:ffff::1]/x',
    'http://[fe80::1]/x',
    'http://[febf:ffff::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:169.254.169.254]/x',
  ])(
    'プライベートIP/localhost指定(%s)は400を返す',
    async (url) => {
      const { headers } = await createUserWithHousehold('taro@example.com')

      const res = await app.request(
        '/api/recipes/from-url',
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url }) },
        env,
      )

      expect(res.status).toBe(400)
    },
  )

  it('fetch失敗時は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/1' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('非2xxレスポンスは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    stubFetch(new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }))

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/1' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('HTML以外のcontent-typeは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    stubFetch(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/1' }) },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/recipes/:id (web種別)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function createWebRecipe(headers: Record<string, string>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html><head><meta property="og:title" content="元タイトル"></head></html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    )
    const res = await app.request(
      '/api/recipes/from-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://recipe.example.com/1' }) },
      env,
    )
    vi.unstubAllGlobals()
    return res.json<{ id: number; title: string }>()
  }

  it('web種別はmemoのみ更新でき、titleは変更されない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const recipe = await createWebRecipe(headers)

    const res = await app.request(
      `/api/recipes/${recipe.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ memo: '更新後メモ' }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ title: string; memo: string | null }>()
    expect(body.title).toBe('元タイトル')
    expect(body.memo).toBe('更新後メモ')
  })

  it('manual種別は従来通りtitle等を更新できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: '肉じゃが' }) },
      env,
    )
    const recipe = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/recipes/${recipe.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: '肉じゃが(改)', ingredients: '牛肉', steps: '煮る' }) },
      env,
    )

    expect(res.status).toBe(200)
    expect((await res.json<{ title: string }>()).title).toBe('肉じゃが(改)')
  })
})
