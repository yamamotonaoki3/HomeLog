import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM fixed_costs'),
    env.DB.prepare('DELETE FROM cards'),
    env.DB.prepare('DELETE FROM accounts'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
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

describe('POST /api/fixed-costs', () => {
  it('201で世帯共有(personal=false)の固定費を登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/fixed-costs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ name: string; personal: boolean; editable: boolean }>()
    expect(body.name).toBe('家賃')
    expect(body.personal).toBe(false)
    expect(body.editable).toBe(true)
  })

  it('口座とカードを同時に指定すると400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const accountRes = await app.request(
      '/api/accounts',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '口座', type: 'bank', balance: 0 }) },
      env,
    )
    const account = await accountRes.json<{ id: number }>()
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'カード' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()

    const res = await app.request(
      '/api/fixed-costs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false, accountId: account.id, cardId: card.id }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /api/fixed-costs', () => {
  it('世帯共有の固定費は他メンバーにも見えるが、個人所有は見えない', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)

    await app.request(
      '/api/fixed-costs',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false }) },
      env,
    )
    await app.request(
      '/api/fixed-costs',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '太郎の個人サブスク', amount: 1000, paymentDay: 1, personal: true }) },
      env,
    )

    const memberRes = await app.request('/api/fixed-costs', { headers: memberHeaders }, env)
    const memberList = await memberRes.json<{ name: string; editable: boolean }[]>()
    expect(memberList.map((f) => f.name)).toEqual(['家賃'])
    expect(memberList[0].editable).toBe(false)

    const ownerRes = await app.request('/api/fixed-costs', { headers: owner.headers }, env)
    const ownerList = await ownerRes.json<{ name: string }[]>()
    expect(ownerList.map((f) => f.name).sort()).toEqual(['太郎の個人サブスク', '家賃'].sort())
  })

  it('editableでないメンバーにはaccountId/cardIdが隠される', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const accountRes = await app.request(
      '/api/accounts',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '口座', type: 'bank', balance: 100000 }) },
      env,
    )
    const account = await accountRes.json<{ id: number }>()
    await app.request(
      '/api/fixed-costs',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false, accountId: account.id }) },
      env,
    )

    const memberRes = await app.request('/api/fixed-costs', { headers: memberHeaders }, env)
    const [item] = await memberRes.json<{ accountId: number | null }[]>()
    expect(item.accountId).toBeNull()
  })
})

describe('PATCH/DELETE /api/fixed-costs/:id', () => {
  it('登録者本人は編集・削除できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/fixed-costs',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false }) },
      env,
    )
    const fixedCost = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/fixed-costs/${fixedCost.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '家賃(更新後)', amount: 85000, paymentDay: 27, personal: false }) },
      env,
    )
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json<{ amount: number }>()).amount).toBe(85000)

    const deleteRes = await app.request(`/api/fixed-costs/${fixedCost.id}`, { method: 'DELETE', headers }, env)
    expect(deleteRes.status).toBe(204)
  })

  it('登録者本人以外(世帯共有でも)は編集・削除できず404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const createRes = await app.request(
      '/api/fixed-costs',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false }) },
      env,
    )
    const fixedCost = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/fixed-costs/${fixedCost.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ name: '改変', amount: 1, paymentDay: 1, personal: false }) },
      env,
    )
    expect(patchRes.status).toBe(404)

    const deleteRes = await app.request(`/api/fixed-costs/${fixedCost.id}`, { method: 'DELETE', headers: memberHeaders }, env)
    expect(deleteRes.status).toBe(404)
  })
})
