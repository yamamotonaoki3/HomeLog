import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { purgeExpiredDemos } from '../../lib/demo-cleanup'
import { createDemoHousehold } from '../../lib/demo-seed'
import { issueTokens } from '../../lib/tokens'

// 期限切れのデモの削除(#532)。実在しないメール・名前だけを使う。
const demoEnv = { ...env, DEMO_MODE: 'true' }
const HOUR = 3_600_000
const json = { 'Content-Type': 'application/json' }

// 件数を比べない表: 移行の記録、回数制限、Cloudflareと SQLite の内部表。
const EXCLUDED = /^(d1_migrations|rate_limit_counters|_cf_.*|sqlite_.*)$/

async function tableCounts(): Promise<Record<string, number>> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()
  const names = tables.results.map((row) => row.name).filter((name) => !EXCLUDED.test(name))
  const results = await env.DB.batch<{ n: number }>(names.map((name) => env.DB.prepare(`SELECT COUNT(*) AS n FROM "${name}"`)))
  return Object.fromEntries(names.map((name, index) => [name, results[index].results[0].n]))
}

async function clearAll() {
  const tables = [
    'expense_split_comments', 'expense_splits', 'expenses', 'incomes', 'fixed_cost_splits', 'fixed_cost_posting_suppressions', 'fixed_costs',
    'events', 'card_charges', 'cards', 'accounts', 'menu_entries', 'recipes', 'shopping_purchase_requests', 'shopping_list_items', 'inventory_items',
    'stores', 'zaiko_categories', 'kakeibo_categories', 'income_categories', 'external_persons', 'user_settings', 'refresh_tokens',
    'password_reset_tokens', 'household_members', 'households', 'users', 'demo_households',
  ]
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
}

// 通常の世帯・利用者(デモではない)。口座・店・世帯外の相手・割り勘・コメント・リフレッシュトークンも持つ。
async function createNormalWorld(label: string) {
  const insertUser = async (suffix: string) =>
    (await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
      .bind(`testuser_${label}_${suffix}@example.com`, 'testuser_unused_hash', `testuser_${label}_${suffix}`)
      .first<{ id: number }>())!.id
  const a = await insertUser('a')
  const b = await insertUser('b')
  const household = (await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `TESTCODE${label}`.slice(0, 16).padEnd(16, '0'))
    .first<{ id: number }>())!.id
  await env.DB.batch([
    env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household, a),
    env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household, b),
    env.DB.prepare('INSERT INTO kakeibo_categories (household_id, name, is_default) VALUES (?, ?, 1)').bind(household, '食費'),
    env.DB.prepare('INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?)').bind(household, a, 'テスト口座', 'bank', 1000),
    env.DB.prepare('INSERT INTO stores (household_id, name) VALUES (?, ?)').bind(household, 'テスト店'),
    env.DB.prepare('INSERT INTO external_persons (household_id, name) VALUES (?, ?)').bind(household, 'テスト相手'),
    env.DB.prepare(
      `INSERT INTO expenses (household_id, payer_user_id, category_id, amount, purpose, expense_date)
       VALUES (?, ?, (SELECT id FROM kakeibo_categories WHERE household_id = ?), 500, ?, ?)`,
    ).bind(household, a, household, 'テスト支出', '2026-01-01'),
    env.DB.prepare('INSERT INTO expense_splits (expense_id, debtor_user_id, split_ratio, amount_due) VALUES ((SELECT id FROM expenses WHERE household_id = ?), ?, 50, 250)').bind(household, b),
    env.DB.prepare('INSERT INTO expense_split_comments (expense_split_id, author_user_id, body) VALUES ((SELECT s.id FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ?), ?, ?)').bind(household, a, 'テストコメント'),
    env.DB.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(a, `testhash_${label}`, '2099-01-01T00:00:00.000Z'),
  ])
  return { a, b, household }
}

const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, { method, headers: { ...json, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }, demoEnv)

// デモを作り、太郎としてコメント・世帯外の相手・店・追加のリフレッシュトークンを足す。
async function createDemoWithUserData(now: Date) {
  const demo = await createDemoHousehold(env.DB, now)
  const { accessToken } = await issueTokens(demoEnv, demo.primaryUserId)
  const splits = await (await call('GET', '/api/expense-splits', accessToken)).json<Array<{ id: number }>>()
  expect((await call('POST', `/api/expense-splits/${splits[0].id}/comments`, accessToken, { body: 'テストコメント' })).status).toBe(201)
  expect((await call('POST', '/api/stores', accessToken, { name: 'テスト店' })).status).toBe(201)
  const categories = await (await call('GET', '/api/kakeibo-categories', accessToken)).json<Array<{ id: number }>>()
  const expense = await call('POST', '/api/expenses', accessToken, {
    expenseDate: '2026-01-02', amount: 1000, categoryId: categories[0].id, splitInputType: 'ratio', splits: [{ debtorExternalName: 'テスト相手', ratio: 50 }],
  })
  expect(expense.status).toBe(201)
  await issueTokens(demoEnv, demo.partnerUserId)
  return demo
}

const expire = (householdId: number) =>
  env.DB.prepare('UPDATE demo_households SET expires_at = ? WHERE household_id = ?').bind(new Date(Date.now() - HOUR).toISOString(), householdId).run()

beforeEach(clearAll)
afterEach(() => vi.restoreAllMocks())

describe('purgeExpiredDemos', () => {
  it('期限切れデモを削除する batch は40文以下に収まる', async () => {
    const demo = await createDemoHousehold(env.DB, new Date())
    await expire(demo.householdId)
    const batch = vi.spyOn(env.DB, 'batch')
    expect(await purgeExpiredDemos(env.DB, new Date())).toBe(1)
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0].length).toBeLessThanOrEqual(40)
  })

  it('期限切れのデモだけを全テーブルから消す（期限内のデモと通常の世帯・利用者は1行も消えない）', async () => {
    await createNormalWorld('normal')
    await createDemoHousehold(env.DB, new Date())
    const before = await tableCounts()

    const expired = await createDemoWithUserData(new Date())
    await expire(expired.householdId)
    // 削除の対象に、デモ中に足した行が含まれていることを確かめてから消す。
    const during = await tableCounts()
    for (const table of ['expense_split_comments', 'stores', 'external_persons', 'refresh_tokens']) {
      expect(during[table], table).toBeGreaterThan(before[table])
    }

    expect(await purgeExpiredDemos(env.DB, new Date())).toBe(1)
    expect(await tableCounts()).toEqual(before)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?').bind('testuser_normal_%').first()).toEqual({ n: 2 })
  })

  it('期限内のデモは消さない', async () => {
    await createDemoHousehold(env.DB, new Date())
    const before = await tableCounts()
    expect(await purgeExpiredDemos(env.DB, new Date())).toBe(0)
    expect(await tableCounts()).toEqual(before)
  })

  it('期限ちょうど（expires_at と同じ時刻）のデモは期限切れとして消す', async () => {
    const now = new Date()
    const demo = await createDemoHousehold(env.DB, now)
    await env.DB.prepare('UPDATE demo_households SET expires_at = ? WHERE household_id = ?').bind(now.toISOString(), demo.householdId).run()
    expect(await purgeExpiredDemos(env.DB, now)).toBe(1)
    expect(await tableCounts()).toMatchObject({ users: 0, households: 0, demo_households: 0 })
  })

  it('期限切れが複数（3件）あっても1回の batch で全部消える', async () => {
    await createNormalWorld('normal')
    const keep = await createDemoHousehold(env.DB, new Date())
    for (let i = 0; i < 3; i += 1) await expire((await createDemoHousehold(env.DB, new Date())).householdId)
    const batch = vi.fn((statements: D1PreparedStatement[]) => env.DB.batch(statements))
    const db = { prepare: (query: string) => env.DB.prepare(query), batch } as unknown as D1Database
    expect(await purgeExpiredDemos(db, new Date())).toBe(3)
    expect(batch).toHaveBeenCalledTimes(1)
    // D1の無料プランは1回の実行で50クエリまで。batch内の各文も数え、文の数は世帯の数によらず一定にする。
    expect(batch.mock.calls[0][0].length).toBeLessThanOrEqual(50)
    expect((await env.DB.prepare('SELECT household_id AS id FROM demo_households').all<{ id: number }>()).results).toEqual([{ id: keep.householdId }])
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).toEqual({ n: 4 })
  })

  it('期限切れが0件なら batch を呼ばない', async () => {
    const batch = vi.fn()
    const db = { prepare: (query: string) => env.DB.prepare(query), batch } as unknown as D1Database
    expect(await purgeExpiredDemos(db, new Date())).toBe(0)
    expect(batch).not.toHaveBeenCalled()
  })

  it('途中で失敗したら何も消えない（1つのbatch）', async () => {
    const demo = await createDemoHousehold(env.DB, new Date())
    await expire(demo.householdId)
    // 通常の世帯の支出が、期限切れのデモの口座を指していると、口座の削除が外部キーに反して失敗する。
    const normal = await createNormalWorld('other')
    await env.DB.prepare('UPDATE expenses SET account_id = (SELECT id FROM accounts WHERE household_id = ? LIMIT 1) WHERE household_id = ?').bind(demo.householdId, normal.household).run()
    const before = await tableCounts()
    await expect(purgeExpiredDemos(env.DB, new Date())).rejects.toThrow()
    expect(await tableCounts()).toEqual(before)
  })
})
