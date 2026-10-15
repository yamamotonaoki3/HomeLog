import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

let headers: Record<string, string>
let userId: number
let householdId: number
let categoryId: number
let accountId: number

async function request(path: string, body?: unknown, method = 'POST') {
  return app.request(`/api/${path}`, {
    method, headers: { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env)
}
function income(overrides: Record<string, unknown> = {}) {
  return { incomeDate: '2026-10-01', amount: 2500, content: '[E2E_TEST] income', categoryId, accountId, ...overrides }
}
async function balance() {
  return env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(accountId).first<number>('balance')
}
async function count() {
  return env.DB.prepare('SELECT COUNT(*) AS n FROM incomes').first<number>('n')
}

beforeEach(async () => {
  await env.DB.batch(['fixed_cost_splits', 'fixed_costs', 'expense_splits', 'external_persons', 'incomes', 'expenses', 'card_charges', 'cards', 'accounts', 'income_categories', 'kakeibo_categories', 'household_members', 'households', 'users']
    .map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
  const user = await env.DB.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('testuser_income@example.com', 'dummy', 'testuser_income') RETURNING id").first<{ id: number }>()
  userId = user!.id
  const household = await env.DB.prepare("INSERT INTO households (name, invite_code) VALUES ('[E2E_TEST]', 'INCOME244') RETURNING id").first<{ id: number }>()
  householdId = household!.id
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(householdId, userId).run()
  headers = { Authorization: `Bearer ${await signAccessToken(userId, env.JWT_SECRET, 900)}` }
  const categories = await (await request('income-categories', undefined, 'GET')).json<{ id: number }[]>()
  categoryId = categories[0].id
  const account = await (await request('accounts', { name: '[E2E_TEST] salary', type: 'bank', balance: 10000 })).json<{ id: number }>()
  accountId = account.id
})

describe('income account contract #244', () => {
  it('saves the account and adds the income once, including history and GET', async () => {
    const other = await (await request('accounts', { name: '[E2E_TEST] untouched', type: 'bank', balance: 700 })).json<{ id: number }>()
    const card = await (await request('cards', { accountId: other.id, name: '[E2E_TEST] untouched', cardType: 'charge' })).json<{ id: number }>()
    const res = await request('incomes', income())
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ accountId, amount: 2500 })
    expect(await balance()).toBe(12500)
    expect(await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(other.id).first<number>('balance')).toBe(700)
    expect(await env.DB.prepare('SELECT balance FROM cards WHERE id = ?').bind(card.id).first<number>('balance')).toBe(0)
    const rows = await (await request('incomes', undefined, 'GET')).json<unknown[]>()
    expect(rows).toEqual([expect.objectContaining({ accountId, accountName: '[E2E_TEST] salary' })])
    expect(await (await request(`accounts/${accountId}/transactions`, undefined, 'GET')).json()).toMatchObject({
      currentBalance: 12500, transactions: [expect.objectContaining({ type: 'income', direction: 'in', amount: 2500, balanceAfter: 12500 })],
    })
  })

  it.each([undefined, null, '1', 1.5, -1, 999999])('rejects invalid account %s without writes', async (invalid) => {
    expect((await request('incomes', income({ accountId: invalid }))).status).toBe(400)
    expect(await count()).toBe(0)
    expect(await balance()).toBe(10000)
  })

  it('rejects another member and another household accounts', async () => {
    const other = await env.DB.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('testuser_other@example.com', 'dummy', 'testuser_other') RETURNING id").first<{ id: number }>()
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(householdId, other!.id).run()
    await env.DB.prepare('UPDATE accounts SET owner_user_id = ? WHERE id = ?').bind(other!.id, accountId).run()
    expect((await request('incomes', income())).status).toBe(400)
    const otherHousehold = await env.DB.prepare("INSERT INTO households (name, invite_code) VALUES ('[E2E_TEST] other', 'OTHER244') RETURNING id").first<{ id: number }>()
    await env.DB.prepare('UPDATE accounts SET owner_user_id = ?, household_id = ? WHERE id = ?').bind(userId, otherHousehold!.id, accountId).run()
    expect((await request('incomes', income())).status).toBe(400)
    expect(await count()).toBe(0)
    expect(await balance()).toBe(10000)
  })

  it.each([0, 0.5, 10000000000])('rejects amount %s without writes', async (amount) => {
    expect((await request('incomes', income({ amount }))).status).toBe(400)
    expect(await count()).toBe(0)
    expect(await balance()).toBe(10000)
  })

  it('accepts boundary amounts and concurrent increments without lost updates', async () => {
    const responses = await Promise.all([request('incomes', income({ amount: 1 })), request('incomes', income({ amount: 9999999999 }))])
    expect(responses.map((r) => r.status)).toEqual([201, 201])
    expect(await balance()).toBe(10000010000)
    expect(await count()).toBe(2)
  })

  it('rolls back the income when the balance update fails', async () => {
    await env.DB.exec("CREATE TRIGGER fail_income_balance BEFORE UPDATE OF balance ON accounts BEGIN SELECT RAISE(ABORT, 'test balance failure'); END")
    try {
      expect((await request('incomes', income())).status).toBe(500)
      expect(await count()).toBe(0)
      expect(await balance()).toBe(10000)
    } finally {
      await env.DB.exec('DROP TRIGGER fail_income_balance')
    }
  })

  it('rolls back the preceding balance update when income insertion fails', async () => {
    await env.DB.exec("CREATE TRIGGER fail_income_insert BEFORE INSERT ON incomes BEGIN SELECT RAISE(ABORT, 'test income failure'); END")
    try {
      expect((await request('incomes', income())).status).toBe(500)
      expect(await count()).toBe(0)
      expect(await balance()).toBe(10000)
    } finally {
      await env.DB.exec('DROP TRIGGER fail_income_insert')
    }
  })

  it('rejects unauthenticated and invalid category/date requests without side effects', async () => {
    expect((await app.request('/api/incomes', { method: 'POST', body: JSON.stringify(income()) }, env)).status).toBe(401)
    for (const invalid of [{ categoryId: 999999 }, { incomeDate: '2026-02-31' }, { content: ' ' }]) {
      expect((await request('incomes', income(invalid))).status).toBe(400)
    }
    expect(await count()).toBe(0)
    expect(await balance()).toBe(10000)
  })

  it('does not save an income when the balance update affects zero rows', async () => {
    await env.DB.exec('CREATE TRIGGER ignore_income_balance BEFORE UPDATE OF balance ON accounts BEGIN SELECT RAISE(IGNORE); END')
    try {
      expect((await request('incomes', income())).status).toBe(400)
      expect(await count()).toBe(0)
      expect(await balance()).toBe(10000)
    } finally {
      await env.DB.exec('DROP TRIGGER ignore_income_balance')
    }
  })

  it('soft deletes an income account, retains its name, hides it and rejects reuse', async () => {
    const child = await (await request('cards', { accountId, name: '[E2E_TEST] child', cardType: 'charge' })).json<{ id: number }>()
    const active = await (await request('accounts', { name: '[E2E_TEST] active', type: 'bank', balance: 0 })).json<{ id: number }>()
    const activeCard = await (await request('cards', { accountId: active.id, name: '[E2E_TEST] active', cardType: 'charge' })).json<{ id: number }>()
    await request('incomes', income())
    expect((await request(`accounts/${accountId}`, undefined, 'DELETE')).status).toBe(204)
    expect(await env.DB.prepare('SELECT deleted_at FROM accounts WHERE id = ?').bind(accountId).first<string>('deleted_at')).toBeTruthy()
    expect(await (await request('accounts', undefined, 'GET')).json()).toEqual([expect.objectContaining({ id: active.id, balance: 0 })])
    expect(await (await request('incomes', undefined, 'GET')).json()).toEqual([expect.objectContaining({ accountId, accountName: '[E2E_TEST] salary' })])
    expect((await request('incomes', income())).status).toBe(400)
    expect((await request('cards', { accountId, name: '[E2E_TEST]' })).status).toBe(400)
    const categories = await (await request('kakeibo-categories', undefined, 'GET')).json<{ id: number }[]>()
    expect((await request('expenses', { expenseDate: '2026-10-01', amount: 1, categoryId: categories[0].id, accountId })).status).toBe(400)
    expect((await request('expenses', { expenseDate: '2026-10-01', amount: 1, categoryId: categories[0].id, cardId: child.id })).status).toBe(400)
    for (const target of [{ accountId }, { cardId: child.id }]) {
      expect((await request('fixed-costs', { name: '[E2E_TEST]', amount: 1, paymentDay: 1, personal: true, ...target })).status).toBe(400)
    }
    expect((await request(`cards/${activeCard.id}/charges`, { fromAccountId: accountId, amount: 1 })).status).toBe(400)
    expect((await request(`cards/${child.id}/charges`, { fromAccountId: active.id, amount: 1 })).status).toBe(404)
    expect((await request(`accounts/${accountId}`, { name: 'changed', type: 'bank' }, 'PATCH')).status).toBe(404)
    expect((await request(`accounts/${accountId}/transactions`, undefined, 'GET')).status).toBe(404)
    expect((await request(`accounts/${accountId}`, undefined, 'DELETE')).status).toBe(404)
    expect(await balance()).toBe(12500)
  })

  it('preserves settlement income names and rejects a deleted settlement destination', async () => {
    const categories = await (await request('kakeibo-categories', undefined, 'GET')).json<{ id: number }[]>()
    const makeSplit = async () => {
      await request('expenses', { expenseDate: '2026-10-01', amount: 1000, categoryId: categories[0].id, purpose: '[E2E_TEST] split', splitInputType: 'ratio', splits: [{ debtorExternalName: 'testuser_external', ratio: 50 }] })
      const rows = await (await request('expense-splits', undefined, 'GET')).json<{ id: number; status: string }[]>()
      return rows.find((row) => row.status !== 'settled')!.id
    }
    const first = await makeSplit()
    expect((await request(`expense-splits/${first}/settle-self`, { accountId }, 'PATCH')).status).toBe(200)
    expect(await balance()).toBe(10500)
    expect((await request(`accounts/${accountId}`, undefined, 'DELETE')).status).toBe(204)
    expect(await (await request('incomes', undefined, 'GET')).json()).toEqual([expect.objectContaining({ accountId, accountName: '[E2E_TEST] salary' })])
    const second = await makeSplit()
    expect((await request(`expense-splits/${second}/settle-self`, { accountId }, 'PATCH')).status).toBe(400)
    expect(await count()).toBe(1)
    expect(await balance()).toBe(10500)
  })

  it.each(['DELETE FROM accounts WHERE id = ?', 'UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'])('does not save or increment after account disappears between validation and batch: %s', async (sql) => {
    let intercepted = false
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          intercepted = true
          await target.prepare(sql).bind(accountId).run()
          return target.batch(statements)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const res = await app.request('/api/incomes', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(income()) }, { ...env, DB: db })
    expect(intercepted).toBe(true)
    expect(res.status).toBe(400)
    expect(await count()).toBe(0)
    if (sql.startsWith('UPDATE')) expect(await balance()).toBe(10000)
  })

  it('keeps legacy NULL income and balance unchanged, physically deletes unused accounts', async () => {
    await env.DB.prepare('INSERT INTO incomes (household_id, earner_user_id, category_id, amount, content, income_date) VALUES (?, ?, ?, 100, ?, ?)')
      .bind(householdId, userId, categoryId, '[E2E_TEST] legacy', '2020-01-01').run()
    expect(await (await request('incomes', undefined, 'GET')).json()).toEqual([expect.objectContaining({ accountId: null, accountName: null })])
    expect(await balance()).toBe(10000)
    expect((await request(`accounts/${accountId}`, undefined, 'DELETE')).status).toBe(204)
    expect(await balance()).toBeNull()
  })

  it.each(['expense', 'charge-from', 'fixed-cost', 'card-expense', 'card-charge', 'card-fixed-cost', 'card-balance'])('rejects deletion when %s appears after prechecks', async (blocker) => {
    const child = await (await request('cards', { accountId, name: '[E2E_TEST] child', cardType: 'charge' })).json<{ id: number }>()
    const active = await (await request('accounts', { name: '[E2E_TEST] active', type: 'bank', balance: 100 })).json<{ id: number }>()
    const activeCard = await (await request('cards', { accountId: active.id, name: '[E2E_TEST] active', cardType: 'charge' })).json<{ id: number }>()
    const categories = await (await request('kakeibo-categories', undefined, 'GET')).json<{ id: number }[]>()
    await request('incomes', income())
    let intercepted = false
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          intercepted = true
          if (blocker === 'card-balance') {
            await target.prepare('UPDATE cards SET balance = 1 WHERE id = ?').bind(child.id).run()
          } else {
            const result = blocker === 'charge-from'
              ? await request(`cards/${activeCard.id}/charges`, { fromAccountId: accountId, amount: 1 })
              : blocker === 'card-charge'
                ? await request(`cards/${child.id}/charges`, { fromAccountId: active.id, amount: 1 })
                : blocker.includes('fixed-cost')
                  ? await request('fixed-costs', { name: '[E2E_TEST] race', amount: 1, paymentDay: 1, personal: true, ...(blocker === 'fixed-cost' ? { accountId } : { cardId: child.id }) })
                  : await request('expenses', { expenseDate: '2026-10-01', amount: 1, categoryId: categories[0].id, ...(blocker === 'expense' ? { accountId } : { cardId: child.id }) })
            expect(result.ok).toBe(true)
          }
          return target.batch(statements)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const res = await app.request(`/api/accounts/${accountId}`, { method: 'DELETE', headers }, { ...env, DB: db })
    expect(intercepted).toBe(true)
    expect(res.status).toBe(400)
    expect(await env.DB.prepare('SELECT deleted_at FROM accounts WHERE id = ?').bind(accountId).first<string>('deleted_at')).toBeNull()
    expect(await (await request('accounts', undefined, 'GET')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: accountId })]))
  })

  it.each(['expense', 'card-expense', 'charge-from', 'card-charge', 'settlement'])('rejects %s atomically if the account is deleted after validation', async (kind) => {
    const child = await (await request('cards', { accountId, name: '[E2E_TEST] child', cardType: 'charge' })).json<{ id: number }>()
    const active = await (await request('accounts', { name: '[E2E_TEST] active', type: 'bank', balance: 100 })).json<{ id: number }>()
    const activeCard = await (await request('cards', { accountId: active.id, name: '[E2E_TEST] active', cardType: 'charge' })).json<{ id: number }>()
    const categories = await (await request('kakeibo-categories', undefined, 'GET')).json<{ id: number }[]>()
    await request('incomes', income())
    let path: string
    let body: unknown
    let method = 'POST'
    if (kind === 'settlement') {
      await request('expenses', { expenseDate: '2026-10-01', amount: 1000, categoryId: categories[0].id, splitInputType: 'ratio', splits: [{ debtorExternalName: 'testuser_race', ratio: 50 }] })
      const splits = await (await request('expense-splits', undefined, 'GET')).json<{ id: number }[]>()
      path = `expense-splits/${splits[0].id}/settle-self`
      body = { accountId }
      method = 'PATCH'
    } else if (kind.includes('charge')) {
      path = `cards/${kind === 'charge-from' ? activeCard.id : child.id}/charges`
      body = { fromAccountId: kind === 'charge-from' ? accountId : active.id, amount: 1 }
    } else {
      path = 'expenses'
      body = { expenseDate: '2026-10-01', amount: 1, categoryId: categories[0].id, ...(kind === 'expense' ? { accountId } : { cardId: child.id }) }
    }
    const expensesBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first<number>('n')
    let intercepted = false
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          intercepted = true
          await target.prepare('UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(accountId).run()
          return target.batch(statements)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const res = await app.request(`/api/${path}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ...env, DB: db })
    expect(intercepted).toBe(true)
    expect(res.status).toBe(400)
    expect(await balance()).toBe(12500)
    expect(await count()).toBe(1)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first<number>('n')).toBe(expensesBefore)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM card_charges').first<number>('n')).toBe(0)
    expect(await env.DB.prepare('SELECT balance FROM cards WHERE id = ?').bind(child.id).first<number>('balance')).toBe(0)
    expect(await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(active.id).first<number>('balance')).toBe(100)
    if (kind === 'settlement') expect(await env.DB.prepare('SELECT status FROM expense_splits').first<string>('status')).not.toBe('settled')
  })

  it.each(['card', 'fixed-cost', 'account-balance', 'card-balance'])('enforces deleted-account guards at the database write boundary: %s', async (kind) => {
    const card = await (await request('cards', { accountId, name: '[E2E_TEST] child', cardType: 'charge' })).json<{ id: number }>()
    await env.DB.prepare('UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(accountId).run()
    const statement = kind === 'card'
      ? env.DB.prepare("INSERT INTO cards (account_id, name) VALUES (?, '[E2E_TEST] race')").bind(accountId)
      : kind === 'fixed-cost'
        ? env.DB.prepare("INSERT INTO fixed_costs (household_id, created_by_user_id, account_id, name, amount, payment_day, include_in_household_total) VALUES (?, ?, ?, '[E2E_TEST] race', 1, 1, 0)").bind(householdId, userId, accountId)
        : kind === 'account-balance'
          ? env.DB.prepare('UPDATE accounts SET balance = balance + 1 WHERE id = ?').bind(accountId)
          : env.DB.prepare('UPDATE cards SET balance = balance + 1 WHERE id = ?').bind(card.id)
    await expect(statement.run()).rejects.toThrow('ACCOUNT_DELETED')
    expect(await balance()).toBe(10000)
  })
})
