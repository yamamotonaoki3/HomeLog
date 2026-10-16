import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { postDueFixedCosts } from '../../lib/fixed-cost-posting'

let headers: Record<string, string>
let userId: number
let householdId: number
let categoryId: number
let incomeCategoryId: number
let accountId: number

async function request(path: string, method: string, body?: unknown, auth = headers) {
  return app.request(`/api/${path}`, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
}
async function balance(id = accountId, table = 'accounts') {
  return (await env.DB.prepare(`SELECT balance FROM ${table} WHERE id = ?`).bind(id).first<{ balance: number }>())!.balance
}
function expense(extra = {}) {
  return { expenseDate: '2024-02-29', amount: 1000, categoryId, purpose: '[E2E_TEST]', accountId, ...extra }
}
function income(extra = {}) {
  return { incomeDate: '2024-02-29', amount: 1000, categoryId: incomeCategoryId, content: '[E2E_TEST]', accountId, ...extra }
}
beforeEach(async () => {
  await env.DB.exec('DELETE FROM incomes; DELETE FROM expenses; DELETE FROM fixed_costs; DELETE FROM external_persons; DELETE FROM cards; DELETE FROM accounts; DELETE FROM income_categories; DELETE FROM kakeibo_categories; DELETE FROM household_members; DELETE FROM households; DELETE FROM users;')
  userId = (await env.DB.prepare("INSERT INTO users (email,password_hash,display_name) VALUES ('testuser_ledger@example.com','x','testuser_ledger') RETURNING id").first<{ id: number }>())!.id
  householdId = (await env.DB.prepare("INSERT INTO households (name,invite_code) VALUES ('test household','LEDGER275') RETURNING id").first<{ id: number }>())!.id
  await env.DB.prepare('INSERT INTO household_members (household_id,user_id) VALUES (?,?)').bind(householdId, userId).run()
  headers = { Authorization: `Bearer ${await signAccessToken(userId, env.JWT_SECRET, 900)}` }
  categoryId = (await (await request('kakeibo-categories', 'GET')).json<{ id: number }[]>())[0].id
  incomeCategoryId = (await (await request('income-categories', 'GET')).json<{ id: number }[]>())[0].id
  accountId = (await (await request('accounts', 'POST', { name: 'test account', type: 'bank', balance: 10000 })).json<{ id: number }>()).id
})

describe('ledger mutations', () => {
  for (const kind of ['expenses', 'incomes']) {
    const sign = kind === 'expenses' ? -1 : 1
    it(`${kind}: edit amounts, move account and delete with matching balances`, async () => {
      const body = kind === 'expenses' ? expense() : income()
      const created = await request(kind, 'POST', body)
      expect(created.status).toBe(201)
      const { id } = await created.json<{ id: number }>()
      expect(await balance()).toBe(10000 + sign * 1000)
      for (const amount of [1500, 500, 500]) {
        expect((await request(`${kind}/${id}`, 'PUT', { ...body, amount })).status).toBe(200)
        expect(await balance()).toBe(10000 + sign * amount)
      }
      const other = (await (await request('accounts', 'POST', { name: 'test second', type: 'bank', balance: 20000 })).json<{ id: number }>()).id
      expect((await request(`${kind}/${id}`, 'PUT', { ...body, accountId: other, amount: 2000 })).status).toBe(200)
      expect(await balance()).toBe(10000)
      expect(await balance(other)).toBe(20000 + sign * 2000)
      expect((await request(`${kind}/${id}`, 'DELETE')).status).toBe(204)
      expect(await balance(other)).toBe(20000)
      expect((await request(`${kind}/${id}`, 'DELETE')).status).toBe(404)
      expect(await balance(other)).toBe(20000)
    })
    it(`${kind}: authentication and ownership precede body validation`, async () => {
      const { id } = await (await request(kind, 'POST', kind === 'expenses' ? expense() : income())).json<{ id: number }>()
      const stranger = (await env.DB.prepare("INSERT INTO users (email,password_hash,display_name) VALUES ('testuser_other@example.com','x','testuser_other') RETURNING id").first<{ id: number }>())!.id
      await env.DB.prepare('INSERT INTO household_members (household_id,user_id) VALUES (?,?)').bind(householdId, stranger).run()
      const otherAuth = { Authorization: `Bearer ${await signAccessToken(stranger, env.JWT_SECRET, 900)}` }
      for (const method of ['PUT', 'DELETE']) {
        expect((await request(`${kind}/${id}`, method, {}, {})).status).toBe(401)
        expect((await request(`${kind}/${id}`, method, {}, otherAuth)).status).toBe(404)
        expect((await request(`${kind}/999999`, method, {})).status).toBe(404)
        expect((await request(`${kind}/NaN`, method, {})).status).toBe(404)
      }
      expect(await balance()).toBe(10000 + sign * 1000)
    })
    it(`${kind}: invalid inputs leave balances unchanged`, async () => {
      const body = kind === 'expenses' ? expense() : income()
      const { id } = await (await request(kind, 'POST', body)).json<{ id: number }>()
      for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: 10000000000 }, { categoryId: -1 }, { accountId: -1 }, { memo: 'x'.repeat(256) }, kind === 'expenses' ? { expenseDate: '2023-02-29' } : { incomeDate: '2023-02-29' }]) {
        expect((await request(`${kind}/${id}`, 'PUT', { ...body, ...patch })).status).toBe(400)
        expect(await balance()).toBe(10000 + sign * 1000)
      }
    })
  }
  it('legacy NULL income can be updated or deleted without reversing an account', async () => {
    const create = async () => (await env.DB.prepare("INSERT INTO incomes (household_id,earner_user_id,category_id,amount,content,income_date) VALUES (?,?,?,1000,'test','2024-01-01') RETURNING id").bind(householdId, userId, incomeCategoryId).first<{ id: number }>())!.id
    expect((await request(`incomes/${await create()}`, 'DELETE')).status).toBe(204)
    expect(await balance()).toBe(10000)
    expect((await request(`incomes/${await create()}`, 'PUT', income({ amount: 2000 }))).status).toBe(200)
    expect(await balance()).toBe(12000)
  })
  it('deleted old income account rejects both mutations before parsing', async () => {
    const { id } = await (await request('incomes', 'POST', income())).json<{ id: number }>()
    expect((await request(`accounts/${accountId}`, 'DELETE')).status).toBe(204)
    for (const method of ['PUT', 'DELETE']) {
      const res = await request(`incomes/${id}`, method, {})
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'RESOURCE_CONFLICT' })
      expect(await balance()).toBe(11000)
    }
  })
  it('unpaid splits are replaced and comments cascade; omission clears splits', async () => {
    const { id } = await (await request('expenses', 'POST', expense({ splits: [{ debtorExternalName: 'test friend', ratio: 50 }] }))).json<{ id: number }>()
    const old = (await env.DB.prepare('SELECT id FROM expense_splits WHERE expense_id=?').bind(id).first<{ id: number }>())!.id
    await env.DB.prepare("INSERT INTO expense_split_comments (expense_split_id,author_user_id,body) VALUES (?,?,'[E2E_TEST]')").bind(old, userId).run()
    const res = await request(`expenses/${id}`, 'PUT', expense({ amount: 1001, splits: [{ debtorExternalName: 'test new friend', ratio: 50 }] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ splits: [{ amountDue: 500, status: 'unpaid' }] })
    expect(await balance()).toBe(8999)
    expect(await env.DB.prepare('SELECT id FROM expense_split_comments').first()).toBeNull()
    expect((await request(`expenses/${id}`, 'PUT', expense())).status).toBe(200)
    expect(await env.DB.prepare('SELECT id FROM expense_splits').first()).toBeNull()
    expect(await balance()).toBe(9000)
  })
  for (const status of ['requested', 'payment_reported', 'pending', 'settled', 'unknown']) {
    it(`blocks expense mutations with ${status} split`, async () => {
      const { id } = await (await request('expenses', 'POST', expense({ splits: [{ debtorExternalName: 'test friend', ratio: 50 }] }))).json<{ id: number }>()
      await env.DB.prepare('UPDATE expense_splits SET status=? WHERE expense_id=?').bind(status, id).run()
      for (const method of ['PUT', 'DELETE']) {
        expect((await request(`expenses/${id}`, method, expense({ splits: [] }))).status).toBe(409)
        expect(await balance()).toBe(9000)
      }
    })
  }
  it('fixed cost deletion suppresses original posting month but not next month', async () => {
    await request('fixed-costs', 'POST', { name: '[E2E_TEST]', amount: 1000, paymentDay: 1, accountId, personal: false })
    await postDueFixedCosts(env.DB, new Date('2024-01-01'))
    const row = (await env.DB.prepare('SELECT id FROM expenses WHERE fixed_cost_id IS NOT NULL').first<{ id: number }>())!
    expect(await balance()).toBe(9000)
    expect((await request(`expenses/${row.id}`, 'PUT', expense({ expenseDate: '2024-02-01' }))).status).toBe(200)
    expect((await request(`expenses/${row.id}`, 'DELETE')).status).toBe(204)
    expect(await balance()).toBe(10000)
    await postDueFixedCosts(env.DB, new Date('2024-01-01'))
    expect(await balance()).toBe(10000)
    expect(await env.DB.prepare('SELECT id FROM expenses').first()).toBeNull()
    await postDueFixedCosts(env.DB, new Date('2024-02-01'))
    expect(await balance()).toBe(9000)
  })
  it('charge card expense moves cards balance only; credit card uses parent account', async () => {
    const charge = (await (await request('cards', 'POST', { accountId, name: '[E2E_TEST] charge', cardType: 'charge' })).json<{ id: number }>()).id
    const credit = (await (await request('cards', 'POST', { accountId, name: '[E2E_TEST] credit', cardType: 'credit' })).json<{ id: number }>()).id
    const chargeStart = await balance(charge, 'cards')
    const { id } = await (await request('expenses', 'POST', expense({ accountId: null, cardId: charge }))).json<{ id: number }>()
    expect(await balance(charge, 'cards')).toBe(chargeStart - 1000)
    expect((await request(`expenses/${id}`, 'PUT', expense({ accountId: null, cardId: charge, amount: 300 }))).status).toBe(200)
    expect(await balance(charge, 'cards')).toBe(chargeStart - 300)
    expect(await balance()).toBe(10000)
    const moved = await request(`expenses/${id}`, 'PUT', expense({ accountId: null, cardId: credit, amount: 400 }))
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({ accountId, cardId: null })
    expect(await balance(charge, 'cards')).toBe(chargeStart)
    expect(await balance()).toBe(9600)
    expect((await request(`expenses/${id}`, 'DELETE')).status).toBe(204)
    expect(await balance()).toBe(10000)
  })
  it('settlement-generated income records its split and cannot be edited or deleted', async () => {
    const { id } = await (await request('expenses', 'POST', expense({ splits: [{ debtorExternalName: '[E2E_TEST] friend', ratio: 50 }] }))).json<{ id: number }>()
    const splitId = (await env.DB.prepare('SELECT id FROM expense_splits WHERE expense_id=?').bind(id).first<{ id: number }>())!.id
    expect((await request(`expense-splits/${splitId}/settle-self`, 'PATCH', { accountId })).status).toBe(200)
    const generated = (await env.DB.prepare('SELECT id, settlement_split_id FROM incomes').first<{ id: number; settlement_split_id: number }>())!
    expect(generated.settlement_split_id).toBe(splitId)
    const before = await balance()
    for (const method of ['PUT', 'DELETE']) {
      expect((await request(`incomes/${generated.id}`, method, income())).status).toBe(409)
      expect(await balance()).toBe(before)
    }
    const { id: normal } = await (await request('incomes', 'POST', income())).json<{ id: number }>()
    expect((await request(`incomes/${normal}`, 'DELETE')).status).toBe(204)
    expect(await balance()).toBe(before)
  })
  it('stale mutation after a concurrent edit is rejected without double correction', async () => {
    const { id } = await (await request('expenses', 'POST', expense())).json<{ id: number }>()
    // 読み込み後に別の編集が確定した状態を再現する(金額を直接変更し、残高も整合させる)。
    await env.DB.batch([
      env.DB.prepare('UPDATE expenses SET amount = 1500 WHERE id = ?').bind(id),
      env.DB.prepare('UPDATE accounts SET balance = balance - 500 WHERE id = ?').bind(accountId),
    ])
    const { ledgerArgs, ledgerWhere } = await import('../../lib/ledger-mutations')
    const staleArgs = ledgerArgs('expenses', { id, amount: 1000, account_id: accountId, card_id: null, settlement_split_id: null }, householdId, userId)
    const matched = await env.DB.prepare(`SELECT id FROM expenses WHERE ${ledgerWhere('expenses')}`).bind(...staleArgs).first()
    expect(matched).toBeNull()
    expect((await request(`expenses/${id}`, 'DELETE')).status).toBe(204)
    expect(await balance()).toBe(10000)
  })
})
