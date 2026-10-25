import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'

beforeEach(async () => {
  await env.DB.batch(['fixed_cost_splits', 'fixed_costs', 'expense_split_comments', 'expense_splits', 'external_persons', 'incomes', 'expenses', 'card_charges', 'cards', 'accounts', 'income_categories', 'kakeibo_categories', 'household_members', 'households', 'users'].map(table => env.DB.prepare(`DELETE FROM ${table}`)))
})

async function setup() {
  const home = await env.DB.prepare("INSERT INTO households (name, invite_code) VALUES ('[E2E_TEST]', 'HISTORY368') RETURNING id").first<{ id: number }>()
  const people = []
  for (const name of ['payer', 'debtor']) {
    const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id').bind(`testuser_${name}@example.com`, 'dummy', `testuser_${name}`).first<{ id: number }>()
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(home!.id, user!.id).run()
    const headers = { Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 900)}`, 'Content-Type': 'application/json' }
    people.push({ id: user!.id, headers })
  }
  return people
}

async function call(headers: Record<string, string>, path: string, method = 'GET', data?: unknown) {
  return app.request(`/api/${path}`, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, env)
}

async function create(headers: Record<string, string>, path: string, data: unknown) {
  const response = await call(headers, path, 'POST', data)
  expect(response.status).toBe(201)
  return response.json<{ id: number }>()
}

async function snapshot() {
  return Promise.all(['expenses', 'incomes', 'expense_splits', 'cards', 'card_charges'].map(async table => (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results))
}

it('世帯内の精算済みの支払元・受取先口座を削除しても精算履歴と残高を保持する', async () => {
  const [payer, debtor] = await setup()
  const receiving = await create(payer.headers, 'accounts', { name: '[E2E_TEST] receiving', type: 'bank', balance: 3000 })
  const paying = await create(debtor.headers, 'accounts', { name: '[E2E_TEST] paying', type: 'bank', balance: 10000 })
  const categories = await (await call(payer.headers, 'kakeibo-categories')).json<{ id: number }[]>()
  await create(payer.headers, 'expenses', { expenseDate: '2026-10-25', amount: 1000, categoryId: categories[0].id, splitInputType: 'ratio', splits: [{ debtorUserId: debtor.id, ratio: 50 }] })
  const [split] = await (await call(payer.headers, 'expense-splits')).json<{ id: number }[]>()
  for (const [person, action, data] of [[payer, 'request', undefined], [debtor, 'mark-paid', { accountId: paying.id }], [payer, 'confirm-receipt', { accountId: receiving.id }]] as const) {
    expect((await call(person.headers, `expense-splits/${split.id}/${action}`, 'PATCH', data)).status).toBe(200)
  }
  const before = await snapshot()
  expect((await call(debtor.headers, `accounts/${paying.id}`, 'DELETE')).status).toBe(204)
  expect((await call(payer.headers, `accounts/${receiving.id}`, 'DELETE')).status).toBe(204)
  expect(await snapshot()).toEqual(before)
  expect(await env.DB.prepare('SELECT name, balance, deleted_at FROM accounts WHERE id = ?').bind(paying.id).first()).toMatchObject({ name: '[E2E_TEST] paying', balance: 9500, deleted_at: expect.any(String) })
  expect(await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(receiving.id).first('balance')).toBe(3500)
  expect(await (await call(debtor.headers, 'accounts')).json()).toEqual([])
  expect((await call(debtor.headers, `accounts/${paying.id}`, 'DELETE')).status).toBe(404)
  expect((await call(debtor.headers, 'expenses', 'POST', { expenseDate: '2026-10-25', amount: 1, categoryId: categories[0].id, accountId: paying.id })).status).toBe(400)
})

it('残高0の子カードに支出・チャージ履歴があっても全履歴を保持して削除する', async () => {
  const [person] = await setup()
  const account = await create(person.headers, 'accounts', { name: '[E2E_TEST] history', type: 'bank', balance: 1000 })
  const card = await create(person.headers, 'cards', { accountId: account.id, name: '[E2E_TEST] child', cardType: 'charge' })
  expect((await call(person.headers, `cards/${card.id}/charges`, 'POST', { fromAccountId: account.id, amount: 100 })).status).toBe(200)
  const categories = await (await call(person.headers, 'kakeibo-categories')).json<{ id: number }[]>()
  await create(person.headers, 'expenses', { expenseDate: '2026-10-25', amount: 100, categoryId: categories[0].id, cardId: card.id })
  const before = await snapshot()
  expect((await call(person.headers, `accounts/${account.id}`, 'DELETE')).status).toBe(204)
  expect(await snapshot()).toEqual(before)
  expect(await (await call(person.headers, 'accounts')).json()).toEqual([])
  expect((await call(person.headers, `cards/${card.id}/charges`, 'POST', { fromAccountId: account.id, amount: 1 })).status).toBe(404)
})

it('支払報告中の口座を削除しても義務を消さず、精算確定時は口座なしとして扱う', async () => {
  const [payer, debtor] = await setup()
  const account = await create(debtor.headers, 'accounts', { name: '[E2E_TEST] pending payment', type: 'bank', balance: 10000 })
  const categories = await (await call(payer.headers, 'kakeibo-categories')).json<{ id: number }[]>()
  await create(payer.headers, 'expenses', { expenseDate: '2026-10-25', amount: 1000, categoryId: categories[0].id, splitInputType: 'ratio', splits: [{ debtorUserId: debtor.id, ratio: 50 }] })
  const [split] = await (await call(payer.headers, 'expense-splits')).json<{ id: number }[]>()
  expect((await call(payer.headers, `expense-splits/${split.id}/request`, 'PATCH')).status).toBe(200)
  expect((await call(debtor.headers, `expense-splits/${split.id}/mark-paid`, 'PATCH', { accountId: account.id })).status).toBe(200)
  const before = await snapshot()
  expect((await call(debtor.headers, `accounts/${account.id}`, 'DELETE')).status).toBe(204)
  expect(await snapshot()).toEqual(before)
  expect(await env.DB.prepare('SELECT deleted_at FROM accounts WHERE id = ?').bind(account.id).first('deleted_at')).toEqual(expect.any(String))
  expect((await call(payer.headers, `expense-splits/${split.id}/confirm-receipt`, 'PATCH')).status).toBe(200)
  expect(await env.DB.prepare('SELECT status FROM expense_splits WHERE id = ?').bind(split.id).first('status')).toBe('settled')
  expect(await env.DB.prepare('SELECT account_id FROM expenses WHERE settlement_split_id = ?').bind(split.id).first('account_id')).toBeNull()
  expect(await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account.id).first('balance')).toBe(10000)
})
