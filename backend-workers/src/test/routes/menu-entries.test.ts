import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

const MONDAY = '2026-08-31' // 2026-08-31は月曜日。
const NOT_MONDAY = '2026-09-01' // 2026-09-01は火曜日。

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM menu_entries'),
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ userId: number; householdId: number; headers: Record<string, string> }> {
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
  return { userId: user.id, householdId: household.id, headers: { Authorization: `Bearer ${token}` } }
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

async function createRecipe(headers: Record<string, string>, title: string): Promise<{ id: number }> {
  const res = await app.request(
    '/api/recipes',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title }) },
    env,
  )
  return res.json()
}

beforeEach(async () => {
  await resetDb()
})

describe('GET /api/menu-entries', () => {
  it('weekStartDateが月曜日でない場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(`/api/menu-entries?weekStartDate=${NOT_MONDAY}`, { headers }, env)

    expect(res.status).toBe(400)
  })

  it('weekStartDate未指定の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/menu-entries', { headers }, env)

    expect(res.status).toBe(400)
  })

  it('指定週のリストが世帯メンバー全員に見える', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const recipe = await createRecipe(owner.headers, '肉じゃが')
    await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ weekStartDate: MONDAY, recipeId: recipe.id }) },
      env,
    )

    const res = await app.request(`/api/menu-entries?weekStartDate=${MONDAY}`, { headers: memberHeaders }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ recipeId: number | null; freeTextMemo: string | null }[]>()
    expect(body).toEqual([
      { id: expect.any(Number), recipeId: recipe.id, recipeTitle: '肉じゃが', freeTextMemo: null, weekStartDate: MONDAY },
    ])
  })

  it('他の週のエントリは含まれない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: '2026-08-24', freeTextMemo: '先週の献立' }) },
      env,
    )
    await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '今週の献立' }) },
      env,
    )

    const res = await app.request(`/api/menu-entries?weekStartDate=${MONDAY}`, { headers }, env)

    const body = await res.json<{ freeTextMemo: string | null }[]>()
    expect(body.map((e) => e.freeTextMemo)).toEqual(['今週の献立'])
  })
})

describe('POST /api/menu-entries', () => {
  it('レシピを選択して確定登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const recipe = await createRecipe(headers, '肉じゃが')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, recipeId: recipe.id }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null; weekStartDate: string }>()
    expect(body.recipeId).toBe(recipe.id)
    expect(body.recipeTitle).toBe('肉じゃが')
    expect(body.freeTextMemo).toBeNull()
    expect(body.weekStartDate).toBe(MONDAY)
  })

  it('自由メモでラフ登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '魚料理' }) },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ recipeId: number | null; freeTextMemo: string | null }>()
    expect(body.recipeId).toBeNull()
    expect(body.freeTextMemo).toBe('魚料理')
  })

  it('recipeIdとfreeTextMemoを両方指定すると400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const recipe = await createRecipe(headers, '肉じゃが')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, recipeId: recipe.id, freeTextMemo: '魚料理' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('空白のみのfreeTextMemoは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '   ' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('recipeIdとfreeTextMemoを両方省略すると400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('weekStartDateが月曜日でない場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: NOT_MONDAY, freeTextMemo: '魚料理' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('他世帯のレシピIDを指定すると400を返す', async () => {
    const other = await createUserWithHousehold('jiro@example.com')
    const otherRecipe = await createRecipe(other.headers, '他世帯のレシピ')
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, recipeId: otherRecipe.id }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('世帯メンバーは誰でも追加できる', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)

    const res = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '外食' }) },
      env,
    )

    expect(res.status).toBe(201)
  })
})

describe('DELETE /api/menu-entries/:id', () => {
  it('世帯メンバーは誰でも削除できる', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const createRes = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '外食' }) },
      env,
    )
    const entry = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/menu-entries/${entry.id}`, { method: 'DELETE', headers: memberHeaders }, env)

    expect(res.status).toBe(204)
  })

  it('他世帯のエントリを指定すると404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('jiro@example.com')
    const createRes = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ weekStartDate: MONDAY, freeTextMemo: '外食' }) },
      env,
    )
    const entry = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/menu-entries/${entry.id}`, { method: 'DELETE', headers: other.headers }, env)

    expect(res.status).toBe(404)
  })
})

describe('レシピ削除時の扱い', () => {
  it('レシピが削除されると献立の行は残りrecipeIdがNULLになる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const recipe = await createRecipe(headers, '肉じゃが')
    const createRes = await app.request(
      '/api/menu-entries',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ weekStartDate: MONDAY, recipeId: recipe.id }) },
      env,
    )
    const entry = await createRes.json<{ id: number }>()

    await app.request(`/api/recipes/${recipe.id}`, { method: 'DELETE', headers }, env)

    const res = await app.request(`/api/menu-entries?weekStartDate=${MONDAY}`, { headers }, env)
    const body = await res.json<{ id: number; recipeId: number | null; recipeTitle: string | null }[]>()
    const remaining = body.find((e) => e.id === entry.id)
    expect(remaining).toBeDefined()
    expect(remaining?.recipeId).toBeNull()
    expect(remaining?.recipeTitle).toBeNull()
  })
})
