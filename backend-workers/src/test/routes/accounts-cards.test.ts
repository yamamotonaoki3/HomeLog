import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM incomes'),
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM fixed_costs'),
    env.DB.prepare('DELETE FROM card_charges'),
    env.DB.prepare('DELETE FROM cards'),
    env.DB.prepare('DELETE FROM accounts'),
    env.DB.prepare('DELETE FROM income_categories'),
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

async function createAccount(headers: Record<string, string>, balance = 10000): Promise<{ id: number }> {
  const res = await app.request(
    '/api/accounts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'メイン口座', type: 'bank', balance }),
    },
    env,
  )
  return res.json()
}

beforeEach(async () => {
  await resetDb()
})

describe('口座管理', () => {
  it('作成・一覧取得ができ、他人の口座は見えない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('hanako@example.com')
    await createAccount(headers)
    await createAccount(other.headers)

    const res = await app.request('/api/accounts', { headers }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string; balance: number; cards: unknown[] }[]>()
    expect(body).toHaveLength(1)
    expect(body[0].balance).toBe(10000)
    expect(body[0].cards).toEqual([])
  })

  it('編集できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)

    const res = await app.request(
      `/api/accounts/${account.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'サブ口座', type: 'e_money' }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string; type: string }>()
    expect(body.name).toBe('サブ口座')
    expect(body.type).toBe('e_money')
  })

  it('使用中(支出で参照)の口座は削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const categoryRes = await app.request('/api/kakeibo-categories', { headers }, env)
    const [category] = await categoryRes.json<{ id: number }[]>()
    await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 500, purpose: '昼食', categoryId: category.id, accountId: account.id }),
      },
      env,
    )

    const res = await app.request(`/api/accounts/${account.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('未使用の口座は削除でき204を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)

    const res = await app.request(`/api/accounts/${account.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(204)
  })

  it('固定費の引き落とし元(口座)に指定されている口座は削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    await app.request(
      '/api/fixed-costs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '家賃', amount: 80000, paymentDay: 27, personal: false, accountId: account.id }),
      },
      env,
    )

    const res = await app.request(`/api/accounts/${account.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('固定費の引き落とし元(カード)の親口座は削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'クレカ' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      '/api/fixed-costs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '定期購入', amount: 1000, paymentDay: 27, personal: false, cardId: card.id }),
      },
      env,
    )

    const res = await app.request(`/api/accounts/${account.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('他人の口座を指定すると404を返す', async () => {
    const other = await createUserWithHousehold('hanako@example.com')
    const otherAccount = await createAccount(other.headers)
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(`/api/accounts/${otherAccount.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(404)
  })
})

describe('カード管理', () => {
  it('creditカードを作成でき、口座の中に含まれる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)

    const res = await app.request(
      '/api/cards',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ accountId: account.id, name: 'メインカード' }),
      },
      env,
    )
    expect(res.status).toBe(201)
    const card = await res.json<{ cardType: string; balance: number }>()
    expect(card.cardType).toBe('credit')
    expect(card.balance).toBe(0)

    const listRes = await app.request('/api/accounts', { headers }, env)
    const [accountWithCards] = await listRes.json<{ cards: { name: string }[] }[]>()
    expect(accountWithCards.cards.map((c) => c.name)).toContain('メインカード')
  })

  it('残高が0でない・使用中のカードが紐づく口座は削除できない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ accountId: account.id, name: 'チャージカード', cardType: 'charge' }),
      },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 1000 }) },
      env,
    )

    const res = await app.request(`/api/accounts/${account.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('チャージ型カードへのチャージで、口座残高が減りカード残高が増える', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers, 10000)
    const cardRes = await app.request(
      '/api/cards',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ accountId: account.id, name: 'Suica', cardType: 'charge' }),
      },
      env,
    )
    const card = await cardRes.json<{ id: number }>()

    const res = await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 3000 }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ cardBalanceAfter: number; accountBalanceAfter: number }>()
    expect(body.cardBalanceAfter).toBe(3000)
    expect(body.accountBalanceAfter).toBe(7000)
  })

  it('creditカードへのチャージは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'クレカ' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()

    const res = await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 1000 }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('使用中(支出で参照)のchargeカードは削除できず400を返す', async () => {
    // creditカードの支出はaccount_idに記録され、expenses.card_idはNULLのままになる
    // (既存Java実装のinsertExpenseForCardと同じ挙動)ため、「支出で使用中」の判定に
    // card_idが直接使われるのはchargeカードのケースのみ。
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'Suica', cardType: 'charge' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 2000 }) },
      env,
    )
    const categoryRes = await app.request('/api/kakeibo-categories', { headers }, env)
    const [category] = await categoryRes.json<{ id: number }[]>()
    await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 500, purpose: '昼食', categoryId: category.id, cardId: card.id }),
      },
      env,
    )

    const res = await app.request(`/api/cards/${card.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })

  it('固定費の引き落とし元に指定されているカードは削除できず400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'Suica', cardType: 'charge' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      '/api/fixed-costs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '定期購入', amount: 500, paymentDay: 27, personal: false, cardId: card.id }),
      },
      env,
    )

    const res = await app.request(`/api/cards/${card.id}`, { method: 'DELETE', headers }, env)

    expect(res.status).toBe(400)
  })
})

describe('GET /api/accounts/:id/transactions', () => {
  async function firstCategoryId(headers: Record<string, string>, kind: 'kakeibo' | 'income'): Promise<number> {
    const res = await app.request(kind === 'kakeibo' ? '/api/kakeibo-categories' : '/api/income-categories', { headers }, env)
    const [category] = await res.json<{ id: number }[]>()
    return category.id
  }

  async function addExpense(headers: Record<string, string>, accountId: number, amount: number, purpose = '買い物') {
    const categoryId = await firstCategoryId(headers, 'kakeibo')
    await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2026-01-10', amount, purpose, categoryId, accountId }),
      },
      env,
    )
  }

  it('支出・収入を日付降順で返し、取引後残高を現在残高から逆算する', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers, 10000)
    await addExpense(headers, account.id, 3000) // 10000 -> 7000

    // 割り勘精算経由の収入の代わりに、account_id 付き収入を直接挿入し残高も同期させる。
    const incomeCategoryId = await firstCategoryId(headers, 'income')
    const householdRow = await env.DB.prepare('SELECT household_id FROM accounts WHERE id = ?').bind(account.id).first<{ household_id: number }>()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO incomes (household_id, earner_user_id, category_id, account_id, amount, content, income_date, created_at)
         VALUES (?, (SELECT owner_user_id FROM accounts WHERE id = ?), ?, ?, 1000, '割り勘精算', '2026-01-12', '2026-01-12 00:00:00')`,
      ).bind(householdRow!.household_id, account.id, incomeCategoryId, account.id),
      env.DB.prepare('UPDATE accounts SET balance = balance + 1000 WHERE id = ?').bind(account.id), // 7000 -> 8000
    ])

    const res = await app.request(`/api/accounts/${account.id}/transactions`, { headers }, env)
    expect(res.status).toBe(200)
    const body = await res.json<{
      currentBalance: number
      transactions: { type: string; direction: string; amount: number; balanceAfter: number; description: string }[]
    }>()

    expect(body.currentBalance).toBe(8000)
    expect(body.transactions).toHaveLength(2)
    expect(body.transactions[0]).toMatchObject({ type: 'income', direction: 'in', amount: 1000, balanceAfter: 8000 })
    expect(body.transactions[1]).toMatchObject({ type: 'expense', direction: 'out', amount: 3000, balanceAfter: 7000 })
  })

  it('チャージ元になった口座はチャージが out として履歴に出る', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers, 10000)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'Suica', cardType: 'charge' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 2000 }) },
      env,
    )

    const body = await (await app.request(`/api/accounts/${account.id}/transactions`, { headers }, env)).json<{
      transactions: { type: string; direction: string; amount: number; description: string; balanceAfter: number }[]
    }>()
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0]).toMatchObject({ type: 'charge', direction: 'out', amount: 2000, balanceAfter: 8000 })
    expect(body.transactions[0].description).toContain('Suica')
  })

  it('取引ゼロの口座は空配列を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers, 5000)
    const body = await (await app.request(`/api/accounts/${account.id}/transactions`, { headers }, env)).json<{
      currentBalance: number
      transactions: unknown[]
    }>()
    expect(body.currentBalance).toBe(5000)
    expect(body.transactions).toEqual([])
  })

  it('他人の口座の取引履歴は404', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('hanako@example.com')
    const account = await createAccount(headers)
    const res = await app.request(`/api/accounts/${account.id}/transactions`, { headers: other.headers }, env)
    expect(res.status).toBe(404)
  })

  it('creditカード経由の支出(expenses.account_idに親口座)も履歴に出る', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const account = await createAccount(headers, 10000)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'クレカ' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    const categoryId = await firstCategoryId(headers, 'kakeibo')
    await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2026-02-01', amount: 1500, purpose: '外食', categoryId, cardId: card.id }),
      },
      env,
    )

    const body = await (await app.request(`/api/accounts/${account.id}/transactions`, { headers }, env)).json<{
      transactions: { type: string; direction: string; amount: number; description: string }[]
    }>()
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0]).toMatchObject({ type: 'expense', direction: 'out', amount: 1500, description: '外食' })
  })
})
