import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { postDueFixedCosts } from '../../lib/fixed-cost-posting'

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

async function createUserWithHousehold(email: string): Promise<{ userId: number; householdId: number }> {
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
  return { userId: user.id, householdId: household.id }
}

async function createFixedCost(params: {
  householdId: number
  userId: number
  name: string
  amount: number
  paymentDay: number
  accountId?: number
  cardId?: number
}): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO fixed_costs (household_id, owner_user_id, created_by_user_id, account_id, card_id, name, amount, payment_day, include_in_household_total)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0) RETURNING id`,
  )
    .bind(params.householdId, params.userId, params.accountId ?? null, params.cardId ?? null, params.name, params.amount, params.paymentDay)
    .first<{ id: number }>()
  if (!row) throw new Error('test setup error')
  return row.id
}

beforeEach(async () => {
  await resetDb()
})

describe('postDueFixedCosts', () => {
  it('支払日が一致する固定費のみを計上する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    await createFixedCost({ householdId, userId, name: '家賃', amount: 80000, paymentDay: 27 })
    await createFixedCost({ householdId, userId, name: '保険', amount: 3000, paymentDay: 1 })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const expenses = await env.DB.prepare('SELECT purpose, amount, fixed_cost_year_month FROM expenses').all<{
      purpose: string
      amount: number
      fixed_cost_year_month: string
    }>()
    expect(expenses.results).toHaveLength(1)
    expect(expenses.results[0].purpose).toBe('家賃')
    expect(expenses.results[0].fixed_cost_year_month).toBe('2026-08')
  })

  it('支払日が月末を超える場合は月末日に計上する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    await createFixedCost({ householdId, userId, name: 'サブスク', amount: 500, paymentDay: 31 })

    // 2026-02は28日まで(うるう年ではない)。
    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 1, 28)))

    const expenses = await env.DB.prepare('SELECT purpose FROM expenses').all<{ purpose: string }>()
    expect(expenses.results).toHaveLength(1)
    expect(expenses.results[0].purpose).toBe('サブスク')
  })

  it('カテゴリー「固定費」が未存在なら自動シードして計上する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    await createFixedCost({ householdId, userId, name: '家賃', amount: 80000, paymentDay: 27 })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const category = await env.DB.prepare("SELECT id FROM kakeibo_categories WHERE household_id = ? AND name = '固定費'")
      .bind(householdId)
      .first<{ id: number }>()
    expect(category).not.toBeNull()

    const expense = await env.DB.prepare('SELECT category_id FROM expenses').first<{ category_id: number }>()
    expect(expense?.category_id).toBe(category?.id)
  })

  it('同月に既に計上済みの場合は二重計上しない', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    await createFixedCost({ householdId, userId, name: '家賃', amount: 80000, paymentDay: 27 })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))
    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const expenses = await env.DB.prepare('SELECT id FROM expenses').all()
    expect(expenses.results).toHaveLength(1)
  })

  it('口座指定の固定費は計上時に口座残高を減算する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    const account = await env.DB.prepare(
      'INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(householdId, userId, '口座', 'bank', 100000)
      .first<{ id: number }>()
    if (!account) throw new Error('test setup error')
    await createFixedCost({ householdId, userId, name: '家賃', amount: 80000, paymentDay: 27, accountId: account.id })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const updatedAccount = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account.id).first<{ balance: number }>()
    expect(updatedAccount?.balance).toBe(20000)
  })

  it('チャージ式カード指定の固定費は計上時にカード残高を減算する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    const account = await env.DB.prepare(
      'INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(householdId, userId, '口座', 'bank', 100000)
      .first<{ id: number }>()
    if (!account) throw new Error('test setup error')
    const card = await env.DB.prepare(
      "INSERT INTO cards (account_id, name, card_type, balance) VALUES (?, ?, 'charge', ?) RETURNING id",
    )
      .bind(account.id, 'チャージカード', 5000)
      .first<{ id: number }>()
    if (!card) throw new Error('test setup error')
    await createFixedCost({ householdId, userId, name: '定期購入', amount: 1000, paymentDay: 27, cardId: card.id })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const updatedCard = await env.DB.prepare('SELECT balance FROM cards WHERE id = ?').bind(card.id).first<{ balance: number }>()
    expect(updatedCard?.balance).toBe(4000)
    const updatedAccount = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account.id).first<{ balance: number }>()
    expect(updatedAccount?.balance).toBe(100000)
  })

  it('クレジット式カード指定の固定費は計上時に親口座の残高を減算する', async () => {
    const { userId, householdId } = await createUserWithHousehold('taro@example.com')
    const account = await env.DB.prepare(
      'INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(householdId, userId, '口座', 'bank', 100000)
      .first<{ id: number }>()
    if (!account) throw new Error('test setup error')
    const card = await env.DB.prepare(
      "INSERT INTO cards (account_id, name, card_type, balance) VALUES (?, ?, 'credit', 0) RETURNING id",
    )
      .bind(account.id, 'クレジットカード')
      .first<{ id: number }>()
    if (!card) throw new Error('test setup error')
    await createFixedCost({ householdId, userId, name: '定期購入', amount: 2000, paymentDay: 27, cardId: card.id })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const updatedAccount = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account.id).first<{ balance: number }>()
    expect(updatedAccount?.balance).toBe(98000)
    const expense = await env.DB.prepare('SELECT account_id, card_id FROM expenses').first<{ account_id: number | null; card_id: number | null }>()
    expect(expense?.account_id).toBe(account.id)
    expect(expense?.card_id).toBeNull()
  })

  it('複数世帯の固定費をそれぞれ独立して計上する', async () => {
    const householdA = await createUserWithHousehold('taro@example.com')
    const householdB = await createUserWithHousehold('hanako@example.com')
    await createFixedCost({ householdId: householdA.householdId, userId: householdA.userId, name: '世帯Aの固定費', amount: 1000, paymentDay: 27 })
    await createFixedCost({ householdId: householdB.householdId, userId: householdB.userId, name: '世帯Bの固定費', amount: 2000, paymentDay: 27 })

    await postDueFixedCosts(env.DB, new Date(Date.UTC(2026, 7, 27)))

    const expenses = await env.DB.prepare('SELECT purpose FROM expenses ORDER BY purpose').all<{ purpose: string }>()
    expect(expenses.results.map((e) => e.purpose)).toEqual(['世帯Aの固定費', '世帯Bの固定費'])
  })
})
