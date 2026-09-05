import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_split_comments'),
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM external_persons'),
    env.DB.prepare('DELETE FROM incomes'),
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM cards'),
    env.DB.prepare('DELETE FROM accounts'),
    env.DB.prepare('DELETE FROM income_categories'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createAccount(headers: Record<string, string>, name: string, balance: number): Promise<number> {
  const res = await app.request(
    '/api/accounts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name, type: 'bank', balance }),
    },
    env,
  )
  const account = await res.json<{ id: number }>()
  return account.id
}

async function accountBalance(headers: Record<string, string>, accountId: number): Promise<number> {
  const res = await app.request('/api/accounts', { headers }, env)
  const accounts = await res.json<{ id: number; balance: number }[]>()
  return accounts.find((a) => a.id === accountId)!.balance
}

async function listExpenses(headers: Record<string, string>) {
  const res = await app.request('/api/expenses', { headers }, env)
  return res.json<{ amount: number; purpose: string; categoryId: number; includeInHouseholdTotal: boolean; accountId: number | null }[]>()
}

async function listIncomes(headers: Record<string, string>) {
  const res = await app.request('/api/incomes', { headers }, env)
  return res.json<{ amount: number; content: string; categoryId: number; accountId: number | null }[]>()
}

async function settlementCategoryId(headers: Record<string, string>, kind: 'kakeibo' | 'income'): Promise<number> {
  const res = await app.request(kind === 'kakeibo' ? '/api/kakeibo-categories' : '/api/income-categories', { headers }, env)
  const categories = await res.json<{ id: number; name: string }[]>()
  return categories.find((c) => c.name === '割り勘精算')!.id
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

describe('状態遷移(改訂フロー)', () => {
  async function setup() {
    const owner = await createUserWithHousehold('taro@example.com', 'テスト太郎')
    const member = await createUserWithoutHousehold('hanako@example.com', 'テスト花子')
    await joinHousehold(member.headers, owner.headers)
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }], { amount: 1000 })
    const splitId = await firstSplitId(owner.headers)
    return { owner, member, splitId }
  }

  const patch = (id: number, path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(
      `/api/expense-splits/${id}/${path}`,
      {
        method: 'PATCH',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    )

  it('請求→負担者mark-paid→立替者confirm-receiptでsettledになる', async () => {
    const { owner, member, splitId } = await setup()
    expect((await patch(splitId, 'request', owner.headers)).status).toBe(200)
    expect((await patch(splitId, 'mark-paid', member.headers)).status).toBe(200)
    const res = await patch(splitId, 'confirm-receipt', owner.headers)
    expect(res.status).toBe(200)
    const body = await res.json<{ status: string; settledAt: string | null }>()
    expect(body.status).toBe('settled')
    expect(body.settledAt).not.toBeNull()
  })

  it('confirm-receiptで立替者に収入・負担者に支出が「割り勘精算」で作成される', async () => {
    const { owner, member, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers)
    await patch(splitId, 'confirm-receipt', owner.headers)

    const payerIncomes = await listIncomes(owner.headers)
    expect(payerIncomes).toHaveLength(1)
    expect(payerIncomes[0].amount).toBe(500)
    expect(payerIncomes[0].categoryId).toBe(await settlementCategoryId(owner.headers, 'income'))

    const debtorExpenses = await listExpenses(member.headers)
    expect(debtorExpenses).toHaveLength(1)
    expect(debtorExpenses[0].amount).toBe(500)
    expect(debtorExpenses[0].includeInHouseholdTotal).toBe(false)
    expect(debtorExpenses[0].categoryId).toBe(await settlementCategoryId(member.headers, 'kakeibo'))
  })

  it('口座を指定して精算すると両者の残高が増減する', async () => {
    const { owner, member, splitId } = await setup()
    const debtorAccount = await createAccount(member.headers, '花子の口座', 10000)
    const payerAccount = await createAccount(owner.headers, '太郎の口座', 3000)

    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers, { accountId: debtorAccount })
    await patch(splitId, 'confirm-receipt', owner.headers, { accountId: payerAccount })

    expect(await accountBalance(member.headers, debtorAccount)).toBe(9500) // 10000 - 500
    expect(await accountBalance(owner.headers, payerAccount)).toBe(3500) // 3000 + 500
  })

  it('口座を指定しなければ家計簿の収支だけ作られ残高は動かない', async () => {
    const { owner, member, splitId } = await setup()
    const payerAccount = await createAccount(owner.headers, '太郎の口座', 3000)
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers)
    await patch(splitId, 'confirm-receipt', owner.headers)

    expect(await accountBalance(owner.headers, payerAccount)).toBe(3000)
    expect(await listIncomes(owner.headers)).toHaveLength(1)
    expect(await listExpenses(member.headers)).toHaveLength(1)
  })

  it('他人の口座IDをmark-paidに渡すと400', async () => {
    const { owner, member, splitId } = await setup()
    const payerAccount = await createAccount(owner.headers, '太郎の口座', 3000)
    await patch(splitId, 'request', owner.headers)
    const res = await patch(splitId, 'mark-paid', member.headers, { accountId: payerAccount })
    expect(res.status).toBe(400)
  })

  it('負担者はconfirm-receiptできない(404)、立替者はmark-paidできない(404)', async () => {
    const { owner, member, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers)
    expect((await patch(splitId, 'confirm-receipt', member.headers)).status).toBe(404)

    const s2 = await setup2(owner)
    expect((await patch(s2.splitId, 'mark-paid', owner.headers)).status).toBe(404)
  })

  it('payment_reported以外からのconfirm-receiptは400', async () => {
    const { owner, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    expect((await patch(splitId, 'confirm-receipt', owner.headers)).status).toBe(400)
  })

  it('負担者はholdでpendingにできる', async () => {
    const { owner, member, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers)
    const res = await patch(splitId, 'hold', member.headers)
    expect(res.status).toBe(200)
    expect((await res.json<{ status: string }>()).status).toBe('pending')
  })

  it('settle-selfは相手が世帯内ユーザーだと404', async () => {
    const { owner, splitId } = await setup()
    expect((await patch(splitId, 'settle-self', owner.headers)).status).toBe(404)
  })

  it('settle-self(世帯外)は立替者の収入のみ作成し、負担者支出は作られない', async () => {
    const owner = await createUserWithHousehold('taro@example.com', 'テスト太郎')
    const payerAccount = await createAccount(owner.headers, '太郎の口座', 3000)
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorExternalName: 'E2EUser B', amountDue: 400 }], {
      amount: 1000,
      splitInputType: 'amount',
    })
    const splitId = await firstSplitId(owner.headers)
    const res = await patch(splitId, 'settle-self', owner.headers, { accountId: payerAccount })
    expect(res.status).toBe(200)
    expect((await res.json<{ status: string }>()).status).toBe('settled')

    const incomes = await listIncomes(owner.headers)
    expect(incomes).toHaveLength(1)
    expect(incomes[0].amount).toBe(400)
    expect(await accountBalance(owner.headers, payerAccount)).toBe(3400)
    // 立替者の支出一覧は元の共同支出1件のみ。settle-self では負担者(世帯外)の支出行は作られない
    expect(await listExpenses(owner.headers)).toHaveLength(1)
  })

  it('settledの内訳は削除できない(400)、未精算は削除できる(204)', async () => {
    const { owner, member, splitId } = await setup()
    await patch(splitId, 'request', owner.headers)
    await patch(splitId, 'mark-paid', member.headers)
    await patch(splitId, 'confirm-receipt', owner.headers)
    const del = await app.request(`/api/expense-splits/${splitId}`, { method: 'DELETE', headers: owner.headers }, env)
    expect(del.status).toBe(400)

    const s2 = await setup2(owner)
    const del2 = await app.request(`/api/expense-splits/${s2.splitId}`, { method: 'DELETE', headers: owner.headers }, env)
    expect(del2.status).toBe(204)
  })

  it('負担者はDELETEできない(404)', async () => {
    const { member, splitId } = await setup()
    const res = await app.request(`/api/expense-splits/${splitId}`, { method: 'DELETE', headers: member.headers }, env)
    expect(res.status).toBe(404)
  })

  it('他世帯のsplitは404', async () => {
    const { splitId } = await setup()
    const outsider = await createUserWithHousehold('outsider@example.com')
    expect((await patch(splitId, 'request', outsider.headers)).status).toBe(404)
  })

  // 既存の owner/member 世帯に、外部相手との別の割り勘内訳をもう1件作る。
  async function setup2(owner: { headers: Record<string, string>; userId: number }) {
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorExternalName: 'E2EUser Z', ratio: 30 }], { amount: 2000 })
    const list = await (await app.request('/api/expense-splits', { headers: owner.headers }, env)).json<{ id: number }[]>()
    return { splitId: list[0].id }
  }
})

describe('GET/POST /api/expense-splits/:id/comments', () => {
  interface Comment {
    id: number
    authorUserId: number
    authorLabel: string
    authorRole: 'payer' | 'debtor'
    body: string
    createdAt: string
  }

  async function setup() {
    const owner = await createUserWithHousehold('taro@example.com', 'テスト太郎')
    const member = await createUserWithoutHousehold('hanako@example.com', 'テスト花子')
    await joinHousehold(member.headers, owner.headers)
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }], { amount: 1000 })
    const splitId = await firstSplitId(owner.headers)
    return { owner, member, splitId }
  }

  const getComments = (id: number, headers: Record<string, string>) => app.request(`/api/expense-splits/${id}/comments`, { headers }, env)

  const postComment = (id: number, headers: Record<string, string>, body: unknown) =>
    app.request(
      `/api/expense-splits/${id}/comments`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
      env,
    )

  it('立替者はコメントを投稿・閲覧できる', async () => {
    const { owner, splitId } = await setup()
    const postRes = await postComment(splitId, owner.headers, { body: '来週まで待ってください' })
    expect(postRes.status).toBe(201)
    const posted = await postRes.json<Comment>()
    expect(posted.authorRole).toBe('payer')
    expect(posted.authorLabel).toBe('テスト太郎')
    expect(posted.body).toBe('来週まで待ってください')

    const listRes = await getComments(splitId, owner.headers)
    expect(listRes.status).toBe(200)
    const list = await listRes.json<Comment[]>()
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('来週まで待ってください')
  })

  it('負担者もコメントを投稿・閲覧でき、相手のコメントも見える', async () => {
    const { owner, member, splitId } = await setup()
    await postComment(splitId, owner.headers, { body: '請求します' })
    const debtorPost = await postComment(splitId, member.headers, { body: '少し待ってください' })
    expect(debtorPost.status).toBe(201)
    const posted = await debtorPost.json<Comment>()
    expect(posted.authorRole).toBe('debtor')
    expect(posted.authorLabel).toBe('テスト花子')

    const list = await (await getComments(splitId, member.headers)).json<Comment[]>()
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.body)).toEqual(['請求します', '少し待ってください'])
  })

  it('settled後もコメントは残る(statusによる絞り込みは無い)', async () => {
    const { owner, member, splitId } = await setup()
    await postComment(splitId, member.headers, { body: '保留します' })
    const patch = (path: string, headers: Record<string, string>, body?: unknown) =>
      app.request(
        `/api/expense-splits/${splitId}/${path}`,
        { method: 'PATCH', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) },
        env,
      )
    await patch('request', owner.headers)
    await patch('mark-paid', member.headers)
    await patch('confirm-receipt', owner.headers)

    const list = await (await getComments(splitId, owner.headers)).json<Comment[]>()
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('保留します')
  })

  it('第三者(その内訳の当事者ではない世帯メンバー)は404', async () => {
    const { owner, splitId } = await setup()
    const third = await createUserWithoutHousehold('third@example.com', 'サード')
    await joinHousehold(third.headers, owner.headers)
    expect((await getComments(splitId, third.headers)).status).toBe(404)
    expect((await postComment(splitId, third.headers, { body: 'x' })).status).toBe(404)
  })

  it('別世帯のユーザーは404', async () => {
    const { splitId } = await setup()
    const outsider = await createUserWithHousehold('outsider@example.com')
    expect((await getComments(splitId, outsider.headers)).status).toBe(404)
    expect((await postComment(splitId, outsider.headers, { body: 'x' })).status).toBe(404)
  })

  it('存在しないsplitIdは404', async () => {
    const { owner } = await setup()
    expect((await getComments(999999, owner.headers)).status).toBe(404)
    expect((await postComment(999999, owner.headers, { body: 'x' })).status).toBe(404)
  })

  it('空文字・空白のみのbodyは400', async () => {
    const { owner, splitId } = await setup()
    expect((await postComment(splitId, owner.headers, { body: '' })).status).toBe(400)
    expect((await postComment(splitId, owner.headers, { body: '   ' })).status).toBe(400)
  })

  it('501文字以上のbodyは400', async () => {
    const { owner, splitId } = await setup()
    expect((await postComment(splitId, owner.headers, { body: 'あ'.repeat(501) })).status).toBe(400)
  })

  it('bodyが無い場合は400', async () => {
    const { owner, splitId } = await setup()
    expect((await postComment(splitId, owner.headers, {})).status).toBe(400)
  })
})

describe('GET /api/expense-splits のcommentCount', () => {
  it('コメント件数が正しく集計され、他の内訳の件数と混同しない', async () => {
    const owner = await createUserWithHousehold('taro@example.com', 'テスト太郎')
    const member = await createUserWithoutHousehold('hanako@example.com', 'テスト花子')
    await joinHousehold(member.headers, owner.headers)
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorUserId: member.userId, ratio: 50 }], { amount: 1000, splitInputType: 'ratio' })
    await createExpenseWithSplits(owner.headers, owner.userId, [{ debtorExternalName: 'E2EUser Q', ratio: 50 }], { amount: 2000, splitInputType: 'ratio' })

    const list = await (
      await app.request('/api/expense-splits', { headers: owner.headers }, env)
    ).json<{ id: number; commentCount: number; debtorLabel: string }[]>()
    expect(list.every((s) => s.commentCount === 0)).toBe(true)

    // memberが負担者側の内訳を対象にする(memberが投稿できるのはこちらのみ)。
    const target = list.find((s) => s.debtorLabel === 'テスト花子')!
    await app.request(
      `/api/expense-splits/${target.id}/comments`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ body: '1件目' }) },
      env,
    )
    await app.request(
      `/api/expense-splits/${target.id}/comments`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...member.headers }, body: JSON.stringify({ body: '2件目' }) },
      env,
    )

    const updated = await (await app.request('/api/expense-splits', { headers: owner.headers }, env)).json<{ id: number; commentCount: number }[]>()
    const updatedTarget = updated.find((s) => s.id === target.id)!
    const other = updated.find((s) => s.id !== target.id)!
    expect(updatedTarget.commentCount).toBe(2)
    expect(other.commentCount).toBe(0)
  })
})
