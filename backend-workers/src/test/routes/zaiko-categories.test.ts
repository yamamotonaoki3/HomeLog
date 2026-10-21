import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shopping_list_items'),
    env.DB.prepare('DELETE FROM inventory_items'),
    env.DB.prepare('DELETE FROM stores'),
    env.DB.prepare('DELETE FROM zaiko_categories'),
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

beforeEach(async () => {
  await resetDb()
})

describe('GET /api/zaiko-categories', () => {
  it('初回アクセス時にデフォルト10カテゴリーを遅延シードして返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request('/api/zaiko-categories', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ id: number; name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(10)
    expect(body.every((c) => c.isDefault)).toBe(true)
    expect(body.map((c) => c.name)).toContain('野菜')
  })

  it('2回目以降はシードし直さない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    await app.request('/api/zaiko-categories', { headers }, env)

    const res = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await res.json<unknown[]>()
    expect(body).toHaveLength(10)
  })

  it('同時に複数リクエストが初回GETしても、デフォルトカテゴリーは重複シードされない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/zaiko-categories', { headers }, env)),
    )
    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    const finalRes = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await finalRes.json<unknown[]>()
    expect(body).toHaveLength(10)
  })

  it('GETより先にPOSTでカスタムカテゴリーを作っても、後のGETでデフォルト10件がシードされる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    await app.request(
      '/api/zaiko-categories',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'お菓子' }) },
      env,
    )

    const res = await app.request('/api/zaiko-categories', { headers }, env)
    const body = await res.json<{ name: string; isDefault: boolean }[]>()
    expect(body).toHaveLength(11)
    expect(body.filter((c) => c.isDefault)).toHaveLength(10)
    expect(body.some((c) => c.name === 'お菓子' && !c.isDefault)).toBe(true)
  })
})

describe('POST /api/zaiko-categories', () => {
  it('201でカテゴリーを追加できる(isDefault=false)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ name: string; isDefault: boolean }>()
    expect(body.name).toBe('お菓子')
    expect(body.isDefault).toBe(false)
  })
})

describe('PATCH /api/zaiko-categories/:id', () => {
  it('デフォルトカテゴリーは編集できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const listRes = await app.request('/api/zaiko-categories', { headers }, env)
    const [defaultCategory] = await listRes.json<{ id: number }[]>()

    const res = await app.request(
      `/api/zaiko-categories/${defaultCategory.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '変更後' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('カスタムカテゴリーは編集できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/zaiko-categories/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'スイーツ' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string }>()
    expect(body.name).toBe('スイーツ')
  })

  it('他世帯のカテゴリーを指定すると404を返す', async () => {
    const other = await createUserWithHousehold('hanako@example.com')
    const otherListRes = await app.request('/api/zaiko-categories', { headers: other.headers }, env)
    const [otherCategory] = await otherListRes.json<{ id: number }[]>()

    const { headers } = await createUserWithHousehold('taro@example.com')
    const res = await app.request(
      `/api/zaiko-categories/${otherCategory.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '変更後' }),
      },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/zaiko-categories/:id', () => {
  it('使用中のカテゴリーは削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const listRes = await app.request('/api/zaiko-categories', { headers }, env)
    const [category] = await listRes.json<{ id: number }[]>()
    await app.request(
      '/api/inventory-items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '牛乳', categoryId: category.id, storeId: null, quantity: 1, threshold: 0.5 }),
      },
      env,
    )

    const res = await app.request(`/api/zaiko-categories/${category.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('未使用のカスタムカテゴリーは削除できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/zaiko-categories',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: 'お菓子' }),
      },
      env,
    )
    const created = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/zaiko-categories/${created.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(204)
  })
})

async function categoryRequest(headers: Record<string, string>, name: string, id?: number) {
  return app.request('/api/zaiko-categories' + (id === undefined ? '' : `/${id}`), {
    method: id === undefined ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name }),
  }, env)
}

describe('在庫カテゴリー名の重複防止', () => {
  it('前後空白を除去して保存し、同世帯の同名POSTは409で追加しない', async () => {
    const { headers } = await createUserWithHousehold('testuser_category@example.com')
    const created = await categoryRequest(headers, '  [E2E_TEST] お菓子　')
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ name: '[E2E_TEST] お菓子', isDefault: false })
    const duplicate = await categoryRequest(headers, '[E2E_TEST] お菓子')
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ code: 'DUPLICATE_ZAIKO_CATEGORY_NAME', message: '同じ名前のカテゴリーが既に登録されています' })
    const list = await app.request('/api/zaiko-categories', { headers }, env)
    const categories = await list.json<{ name: string }[]>()
    expect(categories.filter(category => category.name === '[E2E_TEST] お菓子')).toHaveLength(1)
  })

  it('GET前でもデフォルト名を予約し、同時初期シードでも重複を作らない', async () => {
    const { headers } = await createUserWithHousehold('testuser_default@example.com')
    const [post, get] = await Promise.all([
      categoryRequest(headers, ' 野菜　'),
      app.request('/api/zaiko-categories', { headers }, env),
    ])
    expect(post.status).toBe(409)
    expect(get.status).toBe(200)
    const list = await app.request('/api/zaiko-categories', { headers }, env)
    expect((await list.json<{ name: string }[]>()).filter(category => category.name === '野菜')).toHaveLength(1)
  })

  it('他世帯の同名を許可し、大文字小文字・全半角は別名として扱う', async () => {
    const a = await createUserWithHousehold('testuser_category_a@example.com')
    const b = await createUserWithHousehold('testuser_category_b@example.com')
    for (const [headers, name] of [[a.headers, '[E2E_TEST] ABC'], [b.headers, '[E2E_TEST] ABC'], [a.headers, '[E2E_TEST] abc'], [a.headers, '[E2E_TEST] ＡＢＣ']] as const) {
      expect((await categoryRequest(headers, name)).status).toBe(201)
    }
  })

  it('同時POSTの片方だけ成功し、同じ名前を1件だけ保存する', async () => {
    const { headers } = await createUserWithHousehold('testuser_concurrent@example.com')
    const responses = await Promise.all(Array.from({ length: 4 }, () => categoryRequest(headers, '[E2E_TEST] 同時追加')))
    expect(responses.map(response => response.status).sort()).toEqual([201, 409, 409, 409])
    const list = await app.request('/api/zaiko-categories', { headers }, env)
    expect((await list.json<{ name: string }[]>()).filter(category => category.name === '[E2E_TEST] 同時追加')).toHaveLength(1)
  })

  it('自己更新を許可し、別カテゴリーの名前への変更は元データを保持して409', async () => {
    const { headers } = await createUserWithHousehold('testuser_rename@example.com')
    const first = await categoryRequest(headers, '[E2E_TEST] A')
    const second = await categoryRequest(headers, '[E2E_TEST] B')
    const a = await first.json<{ id: number }>()
    const b = await second.json<{ id: number }>()
    expect((await categoryRequest(headers, ' [E2E_TEST] A ', a.id)).status).toBe(200)
    expect((await categoryRequest(headers, '[E2E_TEST] A', b.id)).status).toBe(409)
    expect((await categoryRequest(headers, '野菜', b.id)).status).toBe(409)
    const list = await app.request('/api/zaiko-categories', { headers }, env)
    expect((await list.json<{ id: number; name: string }[]>()).find(category => category.id === b.id)?.name).toBe('[E2E_TEST] B')
  })

  it('同時PATCHでも同名への変更は1件だけ成功する', async () => {
    const { headers } = await createUserWithHousehold('testuser_patch_race@example.com')
    const ids = await Promise.all(['A', 'B'].map(async name => {
      const response = await categoryRequest(headers, '[E2E_TEST] ' + name)
      return (await response.json<{ id: number }>()).id
    }))
    const responses = await Promise.all(ids.map(id => categoryRequest(headers, '[E2E_TEST] 同時変更', id)))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  })

  it('POSTとPATCHが競合しても新しい同名を1件だけ保存する', async () => {
    const { headers } = await createUserWithHousehold('testuser_mixed_race@example.com')
    const created = await categoryRequest(headers, '[E2E_TEST] 元')
    const { id } = await created.json<{ id: number }>()
    const responses = await Promise.all([
      categoryRequest(headers, '[E2E_TEST] 共通'),
      categoryRequest(headers, '[E2E_TEST] 共通', id),
    ])
    expect(responses.filter(response => response.status === 409)).toHaveLength(1)
    expect(responses.filter(response => response.ok)).toHaveLength(1)
    const list = await app.request('/api/zaiko-categories', { headers }, env)
    expect((await list.json<{ name: string }[]>()).filter(category => category.name === '[E2E_TEST] 共通')).toHaveLength(1)
  })

  it('既存名のUnicode前後空白も同名判定し、既存レコードは変更しない', async () => {
    const { headers, userId } = await createUserWithHousehold('testuser_legacy@example.com')
    const oldName = '　[E2E_TEST] 既存　'
    await env.DB.prepare('INSERT INTO zaiko_categories (household_id, name, is_default) SELECT household_id, ?, 0 FROM household_members WHERE user_id = ?').bind(oldName, userId).run()
    expect((await categoryRequest(headers, '[E2E_TEST] 既存')).status).toBe(409)
    const old = await env.DB.prepare('SELECT name FROM zaiko_categories WHERE name = ?').bind(oldName).first<{ name: string }>()
    expect(old?.name).toBe(oldName)
  })

  it.each(['', '　', ' '.repeat(4), 'a'.repeat(51)])('不正な名前は400: %j', async name => {
    const { headers } = await createUserWithHousehold('testuser_invalid@example.com')
    expect((await categoryRequest(headers, name)).status).toBe(400)
  })

  it.each(['a', 'a'.repeat(50)])('1文字・50文字は前後空白を除いて保存できる: %s', async name => {
    const { headers } = await createUserWithHousehold('testuser_length@example.com')
    const response = await categoryRequest(headers, '　' + name + ' ')
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ name })
  })

  it('未認証は401、世帯未所属は404、名前を問わず登録しない', async () => {
    expect((await categoryRequest({}, '[E2E_TEST] 非認証')).status).toBe(401)
    const { headers, userId } = await createUserWithHousehold('testuser_no_household@example.com')
    await env.DB.prepare('DELETE FROM household_members WHERE user_id = ?').bind(userId).run()
    expect((await categoryRequest(headers, '野菜')).status).toBe(404)
  })
})
