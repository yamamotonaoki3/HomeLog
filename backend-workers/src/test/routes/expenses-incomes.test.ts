import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
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

async function getFirstCategoryId(headers: Record<string, string>): Promise<number> {
  const res = await app.request('/api/kakeibo-categories', { headers }, env)
  const [category] = await res.json<{ id: number }[]>()
  return category.id
}

async function getFirstIncomeCategoryId(headers: Record<string, string>): Promise<number> {
  const res = await app.request('/api/income-categories', { headers }, env)
  const [category] = await res.json<{ id: number }[]>()
  return category.id
}

async function createAccount(headers: Record<string, string>, balance = 10000): Promise<{ id: number }> {
  const res = await app.request(
    '/api/accounts',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'メイン口座', type: 'bank', balance }) },
    env,
  )
  return res.json()
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/expenses', () => {
  it('201で支出を登録できる(口座未指定)', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 1000, purpose: '書籍', categoryId }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ amount: number; purpose: string; includeInHouseholdTotal: boolean }>()
    expect(body.amount).toBe(1000)
    expect(body.purpose).toBe('書籍')
    expect(body.includeInHouseholdTotal).toBe(false)
  })

  it('口座を指定すると口座残高が減算される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)
    const account = await createAccount(headers, 10000)

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 1500, purpose: '食料品', categoryId, accountId: account.id }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const accountsRes = await app.request('/api/accounts', { headers }, env)
    const [updatedAccount] = await accountsRes.json<{ balance: number }[]>()
    expect(updatedAccount.balance).toBe(8500)
  })

  it('chargeカードを指定するとカード残高が減算され口座残高は変わらない', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)
    const account = await createAccount(headers, 10000)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'Suica', cardType: 'charge' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()
    await app.request(
      `/api/cards/${card.id}/charges`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fromAccountId: account.id, amount: 3000 }) },
      env,
    )

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 500, purpose: 'ジュース', categoryId, cardId: card.id }),
      },
      env,
    )
    expect(res.status).toBe(201)

    const accountsRes = await app.request('/api/accounts', { headers }, env)
    const [updatedAccount] = await accountsRes.json<{ balance: number; cards: { balance: number }[] }[]>()
    expect(updatedAccount.balance).toBe(7000) // チャージ分のみ減算、支出では変化しない
    expect(updatedAccount.cards[0].balance).toBe(2500) // 3000 - 500
  })

  it('creditカードを指定すると親口座の残高が減算される', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)
    const account = await createAccount(headers, 10000)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'クレカ' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 2000, purpose: '外食', categoryId, cardId: card.id }),
      },
      env,
    )
    expect(res.status).toBe(201)

    const accountsRes = await app.request('/api/accounts', { headers }, env)
    const [updatedAccount] = await accountsRes.json<{ balance: number }[]>()
    expect(updatedAccount.balance).toBe(8000)
  })

  it('口座とカードを同時に指定すると400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)
    const account = await createAccount(headers)
    const cardRes = await app.request(
      '/api/cards',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ accountId: account.id, name: 'クレカ' }) },
      env,
    )
    const card = await cardRes.json<{ id: number }>()

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          expenseDate: '2024-01-01',
          amount: 500,
          purpose: 'テスト',
          categoryId,
          accountId: account.id,
          cardId: card.id,
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('存在しないcategoryIdの場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 500, purpose: 'テスト', categoryId: 99999 }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('金額が0以下の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-01-01', amount: 0, purpose: 'テスト', categoryId }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('存在しない日付(2月31日等)の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstCategoryId(headers)

    const res = await app.request(
      '/api/expenses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ expenseDate: '2024-02-31', amount: 500, purpose: 'テスト', categoryId }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /api/expenses', () => {
  it('自分の支出のみ、categoryIdで絞り込んで取得できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('hanako@example.com')
    const categoryId = await getFirstCategoryId(headers)

    await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: '2024-01-01', amount: 1000, purpose: 'A', categoryId }) },
      env,
    )
    await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ expenseDate: '2024-01-01', amount: 2000, purpose: 'B', categoryId: await getFirstCategoryId(other.headers) }) },
      env,
    )

    const res = await app.request('/api/expenses', { headers }, env)
    const body = await res.json<{ purpose: string }[]>()
    expect(body).toHaveLength(1)
    expect(body[0].purpose).toBe('A')

    const filteredRes = await app.request(`/api/expenses?categoryId=${categoryId}`, { headers }, env)
    expect(await filteredRes.json<unknown[]>()).toHaveLength(1)
  })
})

describe('POST /api/incomes', () => {
  it('201で収入を登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await getFirstIncomeCategoryId(headers)

    const res = await app.request(
      '/api/incomes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ incomeDate: '2024-01-25', amount: 250000, content: '給与', categoryId }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ amount: number; content: string }>()
    expect(body.amount).toBe(250000)
    expect(body.content).toBe('給与')
  })

  it('存在しないcategoryIdの場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/incomes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ incomeDate: '2024-01-25', amount: 1000, content: 'テスト', categoryId: 99999 }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /api/incomes', () => {
  it('自分の収入のみ取得できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('hanako@example.com')
    const categoryId = await getFirstIncomeCategoryId(headers)

    await app.request(
      '/api/incomes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ incomeDate: '2024-01-01', amount: 1000, content: 'A', categoryId }) },
      env,
    )
    await app.request(
      '/api/incomes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ incomeDate: '2024-01-01', amount: 2000, content: 'B', categoryId: await getFirstIncomeCategoryId(other.headers) }) },
      env,
    )

    const res = await app.request('/api/incomes', { headers }, env)
    const body = await res.json<{ content: string }[]>()
    expect(body).toHaveLength(1)
    expect(body[0].content).toBe('A')
  })
})
