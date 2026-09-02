import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM external_persons'),
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string, displayName = 'テスト太郎') {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(email, 'dummy-hash', displayName)
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

async function createUserWithoutHousehold(email: string, displayName = 'テスト花子') {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(email, 'dummy-hash', displayName)
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function joinHousehold(headers: Record<string, string>, ownerHeaders: Record<string, string>) {
  const meRes = await app.request('/api/households/me', { headers: ownerHeaders }, env)
  const me = await meRes.json<{ inviteCode: string }>()
  const joinRes = await app.request(
    '/api/households/join',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inviteCode: me.inviteCode }) },
    env,
  )
  if (joinRes.status !== 200) throw new Error(`join failed: ${joinRes.status}`)
  return headers
}

async function getFirstCategoryId(headers: Record<string, string>): Promise<number> {
  const res = await app.request('/api/kakeibo-categories', { headers }, env)
  const [category] = await res.json<{ id: number }[]>()
  return category.id
}

interface SplitBody {
  debtorUserId?: number
  debtorExternalName?: string
  ratio?: number
  amountDue?: number
}

async function createExpenseWithSplits(
  headers: Record<string, string>,
  _payerUserId: number,
  splits: SplitBody[],
  opts: { amount?: number; splitInputType?: 'ratio' | 'amount' } = {},
) {
  const categoryId = await getFirstCategoryId(headers)
  const amount = opts.amount ?? 1000
  const inputType = opts.splitInputType ?? 'ratio'
  const res = await app.request(
    '/api/expenses',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        expenseDate: '2024-01-01',
        amount,
        purpose: '共同購入',
        categoryId,
        splitInputType: inputType,
        splits,
      }),
    },
    env,
  )
  return res
}

async function firstSplitId(headers: Record<string, string>): Promise<number> {
  const res = await app.request('/api/expense-splits', { headers }, env)
  const [split] = await res.json<{ id: number }[]>()
  return split.id
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/expenses(割り勘)', () => {
  it('世帯メンバーとの50:50割り勘でunpaidの内訳が作成される', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await createUserWithoutHousehold('hanako@example.com')
    await joinHousehold(member.headers, owner.headers)

    const res = await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }])
    expect(res.status).toBe(201)
    const body = await res.json<{ splits: { amountDue: number; status: string; debtorUserId: number }[] }>()
    expect(body.splits).toHaveLength(1) // 支払者の行は永続化されない
    expect(body.splits[0].amountDue).toBe(500)
    expect(body.splits[0].status).toBe('unpaid')
    expect(body.splits[0].debtorUserId).toBe(member.userId)
  })

  it('世帯外の相手は名前入力で都度作成される', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const res = await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorExternalName: 'E2EUser A', ratio: 50 }])
    expect(res.status).toBe(201)
    const persons = await env.DB.prepare('SELECT name FROM external_persons').all<{ name: string }>()
    expect(persons.results.map((p) => p.name)).toContain('E2EUser A')
  })

  it('非メンバーのdebtorUserIdは400', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const stranger = await createUserWithoutHousehold('stranger@example.com')
    const res = await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: stranger.userId, ratio: 50 }])
    expect(res.status).toBe(400)
  })

  it('相手の割合合計が100を超えると400', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await createUserWithoutHousehold('hanako@example.com')
    await joinHousehold(member.headers, owner.headers)
    const res = await createExpenseWithSplits(owner.headers, owner.userId, [
      { debtorUserId: member.userId, ratio: 60 },
      { debtorExternalName: 'E2EUser C', ratio: 60 },
    ])
    expect(res.status).toBe(400)
  })

  it('自分を割り勘の相手に指定すると400', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const res = await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: owner.userId, ratio: 50 }])
    expect(res.status).toBe(400)
  })

  it('splitsを渡さなければ従来通り201', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(owner.headers)
    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...owner.headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 1000, purpose: 'x', categoryId }),
      },
      env,
    )
    expect(res.status).toBe(201)
  })
})

describe('GET /api/expense-splits', () => {
  it('支払者と負担者の双方に見え、第三者には見えない', async () => {
    const owner = await createUserWithHousehold('taro@example.com', 'テスト太郎')
    const member = await createUserWithoutHousehold('hanako@example.com', 'テスト花子')
    await joinHousehold(member.headers, owner.headers)
    const third = await createUserWithoutHousehold('third@example.com', 'サード')
    await joinHousehold(third.headers, owner.headers)

    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }])

    const ownerList = await (await app.request('/api/expense-splits', { headers: owner.headers }, env)).json<{ role: string }[]>()
    expect(ownerList).toHaveLength(1)
    expect(ownerList[0].role).toBe('payer')

    const memberList = await (await app.request('/api/expense-splits', { headers: member.headers }, env)).json<{ role: string; debtorLabel: string }[]>()
    expect(memberList).toHaveLength(1)
    expect(memberList[0].role).toBe('debtor')

    const thirdList = await (await app.request('/api/expense-splits', { headers: third.headers }, env)).json<unknown[]>()
    expect(thirdList).toHaveLength(0)
  })
})

describe('状態遷移', () => {
  async function setup() {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await createUserWithoutHousehold('hanako@example.com')
    await joinHousehold(member.headers, owner.headers)
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }])
    const splitId = await firstSplitId(owner.headers)
    return { owner, member, splitId }
  }

  const patch = (id: number, path: string, headers: Record<string, string>) =>
    app.request(`/api/expense-splits/${id}/${path}`, { method: 'PATCH', headers }, env)

  it('request→receipt-request→approveでsettledになる', async () => {
    const { owner, member, splitId } = await setup()
    expect((await patch(splitId, 'request', owner.headers)).status).toBe(200)
    expect((await patch(splitId, 'receipt-request', owner.headers)).status).toBe(200)
    const res = await patch(splitId, 'approve', member.headers)
    expect(res.status).toBe(200)
    const body = await res.json<{ status: string; settledAt: string | null }>()
    expect(body.status).toBe('settled')
    expect(body.settledAt).not.toBeNull()
  })

  it('負担者はrequestできない(404)', async () => {
    const { member, splitId } = await setup()
    expect((await patch(splitId, 'request', member.headers)).status).toBe(404)
  })

  it('支払者はapproveできない(404)', async () => {
    const { owner, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'receipt-request', owner.headers)
    expect((await patch(splitId, 'approve', owner.headers)).status).toBe(404)
  })

  it('unpaidからapproveは400(状態不整合)', async () => {
    const { member, splitId } = await setup()
    expect((await patch(splitId, 'approve', member.headers)).status).toBe(400)
  })

  it('負担者はholdでpendingにできる', async () => {
    const { owner, member, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    const res = await patch(splitId, 'hold', member.headers)
    expect(res.status).toBe(200)
    expect((await res.json<{ status: string }>()).status).toBe('pending')
  })

  it('settle-selfは相手が世帯内ユーザーだと404', async () => {
    const { owner, splitId } = await setup()
    expect((await patch(splitId, 'settle-self', owner.headers)).status).toBe(404)
  })

  it('settle-selfは相手が世帯外なら支払者の自己申告でsettled', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorExternalName: 'E2EUser B', ratio: 50 }])
    const splitId = await firstSplitId(owner.headers)
    const res = await patch(splitId, 'settle-self', owner.headers)
    expect(res.status).toBe(200)
    expect((await res.json<{ status: string }>()).status).toBe('settled')
  })

  it('他世帯のsplitは404', async () => {
    const { splitId } = await setup()
    const outsider = await createUserWithHousehold('outsider@example.com')
    expect((await patch(splitId, 'request', outsider.headers)).status).toBe(404)
  })

  it('支払者はDELETEできる', async () => {
    const { owner, splitId } = await setup()
    const res = await app.request(`/api/expense-splits/${splitId}`, { method: 'DELETE', headers: owner.headers }, env)
    expect(res.status).toBe(204)
    expect(await firstSplitIdOrNull(owner.headers)).toBeNull()
  })

  it('負担者はDELETEできない(404)', async () => {
    const { member, splitId } = await setup()
    const res = await app.request(`/api/expense-splits/${splitId}`, { method: 'DELETE', headers: member.headers }, env)
    expect(res.status).toBe(404)
  })
})

async function firstSplitIdOrNull(headers: Record<string, string>): Promise<number | null> {
  const res = await app.request('/api/expense-splits', { headers }, env)
  const list = await res.json<{ id: number }[]>()
  return list[0]?.id ?? null
}
