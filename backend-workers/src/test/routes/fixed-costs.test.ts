import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM fixed_cost_splits'),
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

describe('固定費の割り勘設定', () => {
  async function setupHouseholdWithMember() {
    const owner = await createUserWithHousehold('taro@example.com')
    const member = await createUserWithoutHousehold('hanako@example.com')
    await joinHousehold(member.userId, member.headers, owner.headers)
    return { owner, member }
  }

  const postFixedCost = (headers: Record<string, string>, body: unknown) =>
    app.request('/api/fixed-costs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, env)

  it('割り勘設定つきで登録でき、登録者本人のGETには設定が返る', async () => {
    const { owner, member } = await setupHouseholdWithMember()
    const res = await postFixedCost(owner.headers, {
      name: '家賃',
      amount: 100000,
      paymentDay: 27,
      personal: false,
      splitInputType: 'ratio',
      splits: [{ debtorUserId: member.userId, ratio: 50 }],
    })
    expect(res.status).toBe(201)
    const body = await res.json<{ splitInputType: string; splits: { debtorUserId: number; splitRatio: number; amountDue: number }[] }>()
    expect(body.splitInputType).toBe('ratio')
    expect(body.splits).toEqual([{ debtorUserId: member.userId, debtorExternalId: null, debtorExternalName: null, splitRatio: 50, amountDue: 50000 }])

    // 世帯共有の固定費なので member も一覧では見えるが、割り勘設定は非表示。
    const memberList = await (await app.request('/api/fixed-costs', { headers: member.headers }, env)).json<{ splits: unknown[] }[]>()
    expect(memberList[0].splits).toEqual([])
  })

  it('非メンバーの debtorUserId は400', async () => {
    const { owner } = await setupHouseholdWithMember()
    const stranger = await createUserWithoutHousehold('stranger@example.com')
    const res = await postFixedCost(owner.headers, {
      name: '家賃',
      amount: 100000,
      paymentDay: 27,
      personal: false,
      splitInputType: 'ratio',
      splits: [{ debtorUserId: stranger.userId, ratio: 50 }],
    })
    expect(res.status).toBe(400)
  })

  it('自分を割り勘の相手に指定すると400', async () => {
    const { owner, member } = await setupHouseholdWithMember()
    const res = await postFixedCost(owner.headers, {
      name: '家賃',
      amount: 100000,
      paymentDay: 27,
      personal: false,
      splitInputType: 'ratio',
      splits: [{ debtorUserId: owner.userId, ratio: 50 }],
    })
    void member
    expect(res.status).toBe(400)
  })

  it('相手の割合合計が100を超えると400', async () => {
    const { owner, member } = await setupHouseholdWithMember()
    const third = await createUserWithoutHousehold('third@example.com')
    await joinHousehold(third.userId, third.headers, owner.headers)
    const res = await postFixedCost(owner.headers, {
      name: '家賃',
      amount: 100000,
      paymentDay: 27,
      personal: false,
      splitInputType: 'ratio',
      splits: [
        { debtorUserId: member.userId, ratio: 60 },
        { debtorUserId: third.userId, ratio: 60 },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('PATCH で割り勘設定を全置換できる（空配列で削除）', async () => {
    const { owner, member } = await setupHouseholdWithMember()
    const created = await (
      await postFixedCost(owner.headers, {
        name: '家賃',
        amount: 100000,
        paymentDay: 27,
        personal: false,
        splitInputType: 'ratio',
        splits: [{ debtorUserId: member.userId, ratio: 50 }],
      })
    ).json<{ id: number }>()

    const patchRes = await app.request(
      `/api/fixed-costs/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...owner.headers },
        body: JSON.stringify({ name: '家賃', amount: 100000, paymentDay: 27, personal: false, splits: [] }),
      },
      env,
    )
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json<{ splits: unknown[] }>()).splits).toEqual([])
  })
})

describe('External fixed cost splits #253', () => {
  it('trims external names, reuses IDs and deletes splits', async () => {
    const { headers } = await createUserWithHousehold('testuser_external@example.com')
    const data = { name: '[E2E_TEST] external fixed cost', amount: 1001, paymentDay: 1, personal: false, splitInputType: 'ratio', splits: [{ debtorExternalName: '  testuser_friend  ', ratio: 50 }] }
    const send = (method: string, path: string, body: unknown) => app.request(path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
    const created = await send('POST', '/api/fixed-costs', data)
    expect(created.status).toBe(201)
    const body = await created.json<{ id: number; splits: { debtorUserId: number | null; debtorExternalId: number; debtorExternalName: string; amountDue: number }[] }>()
    expect(body.splits[0]).toMatchObject({ debtorUserId: null, debtorExternalName: 'testuser_friend', amountDue: 500 })
    expect(body.splits[0].debtorExternalId).toBeTypeOf('number')
    const updated = await send('PATCH', `/api/fixed-costs/${body.id}`, { ...data, splits: [{ debtorExternalId: body.splits[0].debtorExternalId, ratio: 100 }] })
    expect(updated.status).toBe(200)
    expect((await updated.json<typeof body>()).splits[0]).toMatchObject({ debtorExternalId: body.splits[0].debtorExternalId, amountDue: 1001 })
    const listed = await app.request('/api/fixed-costs', { headers }, env)
    expect((await listed.json<typeof body[]>())[0].splits[0].debtorExternalName).toBe('testuser_friend')
    expect((await send('PATCH', `/api/fixed-costs/${body.id}`, { ...data, splits: [] })).status).toBe(200)
    expect(await env.DB.prepare('SELECT * FROM fixed_cost_splits').all().then(r => r.results)).toHaveLength(0)
  })
  it.each([{}, { debtorExternalName: ' ' }, { debtorExternalName: 'a'.repeat(51) }, { debtorExternalId: 999999 }, { debtorUserId: 999999 }, { debtorExternalName: 'testuser_friend', debtorExternalId: 1 }])('rejects invalid identity %j with 400', async (identity) => {
    const { headers } = await createUserWithHousehold('testuser_invalid@example.com')
    const res = await app.request('/api/fixed-costs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '[E2E_TEST]', amount: 100, paymentDay: 1, personal: false, splits: [{ ...identity, ratio: 50 }] }) }, env)
    expect(res.status).toBe(400)
  })
})

describe('External fixed cost validation and privacy', () => {
  async function fixture() {
    const owner = await createUserWithHousehold('testuser_owner253@example.com')
    const member = await createUserWithoutHousehold('testuser_member253@example.com')
    await joinHousehold(member.userId, member.headers, owner.headers)
    const other = await createUserWithHousehold('testuser_other253@example.com')
    const household = await env.DB.prepare('SELECT household_id FROM household_members WHERE user_id = ?').bind(owner.userId).first<{ household_id: number }>()
    const otherHousehold = await env.DB.prepare('SELECT household_id FROM household_members WHERE user_id = ?').bind(other.userId).first<{ household_id: number }>()
    await env.DB.prepare('INSERT INTO external_persons (id, household_id, name) VALUES (?, ?, ?)').bind(member.userId, household!.household_id, 'testuser_external253').run()
    const foreign = await env.DB.prepare('INSERT INTO external_persons (household_id, name) VALUES (?, ?) RETURNING id').bind(otherHousehold!.household_id, 'testuser_foreign253').first<{ id: number }>()
    const data = { name: '[E2E_TEST] mixed', amount: 1001, paymentDay: 1, personal: false, splitInputType: 'ratio', splits: [{ debtorUserId: member.userId, ratio: 25 }, { debtorExternalId: member.userId, ratio: 25 }, { debtorExternalName: 'testuser_new253', ratio: 25 }] }
    const send = (body: unknown, id?: number) => app.request(`/api/fixed-costs${id ? '/' + id : ''}`, { method: id ? 'PATCH' : 'POST', headers: { ...owner.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
    return { owner, member, other, foreign: foreign!.id, data, send }
  }
  it('keeps equal numeric user/external IDs distinct and hides all split data from others', async () => {
    const { member, data, send } = await fixture()
    const res = await send(data)
    expect(res.status).toBe(201)
    const body = await res.json<{ id: number; splits: { amountDue: number }[] }>()
    expect(body.splits.map(s => s.amountDue)).toEqual([250, 250, 250])
    const list = await app.request('/api/fixed-costs', { headers: member.headers }, env)
    expect((await list.json<{ splits: unknown[]; splitInputType: null }[]>())[0]).toMatchObject({ splits: [], splitInputType: null })
    const forbidden = await app.request(`/api/fixed-costs/${body.id}`, { method: 'PATCH', headers: { ...member.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, env)
    expect(forbidden.status).toBe(404)
    expect((await send({ ...data, personal: true }, body.id)).status).toBe(200)
    expect(await (await app.request('/api/fixed-costs', { headers: member.headers }, env)).json()).toEqual([])
  })
  it('accepts 20 rows, a 50 character name, 0/100 ratios and maximum integer amounts', async () => {
    const { data, send } = await fixture()
    expect((await send({ ...data, splits: Array.from({ length: 20 }, (_, i) => ({ debtorExternalName: `testuser_${i}`, ratio: i === 0 ? 100 : 0 })) })).status).toBe(201)
    expect((await send({ ...data, amount: 9999999999, splitInputType: 'amount', splits: [{ debtorExternalName: 'x'.repeat(50), amountDue: 9999999999 }] })).status).toBe(201)
    expect((await send({ ...data, splitInputType: 'amount', splits: [{ debtorExternalName: 'testuser_zero', amountDue: 0 }] })).status).toBe(201)
  })
  it.each(['self', 'foreignExternal', 'foreignUser', 'duplicateUser', 'duplicateExternal', 'duplicateName', 'tooMany', 'ratioOver', 'ratioTotal', 'amountOver', 'fraction', 'amountTotal', 'multiple'])('rejects %s without changing saved splits or creating names', async kind => {
    const { owner, member, other, foreign, data, send } = await fixture()
    const created = await send(data)
    expect(created.status).toBe(201)
    const body = await created.json<{ id: number }>()
    const before = (await env.DB.prepare('SELECT * FROM fixed_cost_splits').all()).results
    const people = (await env.DB.prepare('SELECT * FROM external_persons').all()).results
    const cases: Record<string, unknown[]> = {
      self: [{ debtorUserId: owner.userId, ratio: 50 }],
      foreignExternal: [{ debtorExternalId: foreign, ratio: 50 }],
      foreignUser: [{ debtorUserId: other.userId, ratio: 50 }],
      duplicateUser: [{ debtorUserId: member.userId, ratio: 10 }, { debtorUserId: member.userId, ratio: 10 }],
      duplicateExternal: [{ debtorExternalId: member.userId, ratio: 10 }, { debtorExternalId: member.userId, ratio: 10 }],
      duplicateName: [{ debtorExternalName: ' testuser_dup ', ratio: 10 }, { debtorExternalName: 'TESTUSER_DUP', ratio: 10 }],
      tooMany: Array.from({ length: 21 }, (_, i) => ({ debtorExternalName: `testuser_${i}`, ratio: 0 })),
      ratioOver: [{ debtorExternalName: 'testuser_invalid', ratio: 101 }],
      ratioTotal: [{ debtorExternalName: 'testuser_first', ratio: 60 }, { debtorExternalName: 'testuser_second', ratio: 60 }],
      amountOver: [{ debtorExternalName: 'testuser_invalid', amountDue: 10000000000 }],
      fraction: [{ debtorExternalName: 'testuser_invalid', amountDue: 0.5 }],
      amountTotal: [{ debtorExternalName: 'testuser_invalid', amountDue: 1002 }],
      multiple: [{ debtorUserId: member.userId, debtorExternalName: 'testuser_invalid', ratio: 50 }],
    }
    expect((await send({ ...data, splitInputType: kind.startsWith('amount') || kind === 'fraction' ? 'amount' : 'ratio', splits: cases[kind] }, body.id)).status).toBe(400)
    expect((await env.DB.prepare('SELECT * FROM fixed_cost_splits').all()).results).toEqual(before)
    expect((await env.DB.prepare('SELECT * FROM external_persons').all()).results).toEqual(people)
  })
})
