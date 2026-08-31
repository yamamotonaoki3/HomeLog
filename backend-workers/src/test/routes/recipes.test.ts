import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
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
