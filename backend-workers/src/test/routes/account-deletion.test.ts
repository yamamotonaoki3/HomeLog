import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { purgeExpiredAccounts } from '../../lib/account-deletion'

// 退会(アカウント削除)の申し込み・取り消し・30日後の削除(#297、F01_auth.md 8-2章)。
const PASSWORD = 'TestPass123!'
const DAY = 24 * 60 * 60 * 1000

async function call(path: string, method: string, body?: unknown, token?: string) {
  return app.request(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
}

async function signUp(label: string) {
  const email = `testuser_del_${label}_${crypto.randomUUID().slice(0, 8)}@example.com`
  const registered = await (await call('auth/register', 'POST', { email, password: PASSWORD, displayName: `テスト${label}` })).json<{ id: number }>()
  const tokens = await (await call('auth/login', 'POST', { email, password: PASSWORD })).json<{ accessToken: string; refreshToken: string }>()
  return { id: registered.id, email, ...tokens }
}

async function createHousehold(...userIds: number[]) {
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] 退会テスト世帯', crypto.randomUUID().slice(0, 16)).first<{ id: number }>()
  for (const userId of userIds) {
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household!.id, userId).run()
  }
  const category = await env.DB.prepare('INSERT INTO kakeibo_categories (household_id, name) VALUES (?, ?) RETURNING id').bind(household!.id, '食費').first<{ id: number }>()
  const incomeCategory = await env.DB.prepare('INSERT INTO income_categories (household_id, name) VALUES (?, ?) RETURNING id').bind(household!.id, '給与').first<{ id: number }>()
  return { id: household!.id, categoryId: category!.id, incomeCategoryId: incomeCategory!.id }
}

const insertId = async (sql: string, ...values: unknown[]) => (await env.DB.prepare(`${sql} RETURNING id`).bind(...values).first<{ id: number }>())!.id
const count = async (sql: string, ...values: unknown[]) => (await env.DB.prepare(sql).bind(...values).first<{ n: number }>())!.n

async function insertExpense(householdId: number, payerId: number, categoryId: number, extra: { accountId?: number | null; cardId?: number | null } = {}) {
  return insertId(
    'INSERT INTO expenses (household_id, payer_user_id, category_id, account_id, card_id, amount, purpose, expense_date) VALUES (?, ?, ?, ?, ?, 1000, ?, ?)',
    householdId, payerId, categoryId, extra.accountId ?? null, extra.cardId ?? null, '[E2E_TEST] 支出', '2030-01-01',
  )
}

async function insertSplit(expenseId: number, debtorId: number, status: string) {
  return insertId('INSERT INTO expense_splits (expense_id, debtor_user_id, split_ratio, amount_due, status) VALUES (?, ?, 50, 500, ?)', expenseId, debtorId, status)
}

async function requestDeletion(token: string, password = PASSWORD) {
  return call('auth/account/deletion', 'POST', { currentPassword: password }, token)
}

async function backdate(userId: number, days: number) {
  await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').bind(new Date(Date.now() - days * DAY).toISOString(), userId).run()
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'testuser_del_%')").run()
})

describe('GET /api/auth/account/deletion-check', () => {
  it('未精算の割り勘(立替者・負担者)と、他の人が負担する固定費を数える', async () => {
    const a = await signUp('check_a')
    const b = await signUp('check_b')
    const h = await createHousehold(a.id, b.id)
    // Aが立て替えた未精算、Bが立て替えてAが負担する請求中、精算済み(数えない)
    await insertSplit(await insertExpense(h.id, a.id, h.categoryId), b.id, 'unpaid')
    await insertSplit(await insertExpense(h.id, b.id, h.categoryId), a.id, 'requested')
    await insertSplit(await insertExpense(h.id, a.id, h.categoryId), b.id, 'settled')
    // Aが登録しBが負担する固定費、Bが登録しAが負担する固定費、Aだけの固定費(数えない)
    const own = await insertId('INSERT INTO fixed_costs (household_id, created_by_user_id, name, amount, payment_day) VALUES (?, ?, ?, 1000, 1)', h.id, a.id, '[E2E_TEST] 共有')
    await insertId('INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_ratio, amount_due) VALUES (?, ?, 50, 500)', own, b.id)
    const others = await insertId('INSERT INTO fixed_costs (household_id, created_by_user_id, name, amount, payment_day) VALUES (?, ?, ?, 1000, 1)', h.id, b.id, '[E2E_TEST] Bの固定費')
    await insertId('INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_ratio, amount_due) VALUES (?, ?, 50, 500)', others, a.id)
    await insertId('INSERT INTO fixed_costs (household_id, owner_user_id, created_by_user_id, name, amount, payment_day) VALUES (?, ?, ?, ?, 1000, 1)', h.id, a.id, a.id, '[E2E_TEST] 自分だけ')

    const res = await call('auth/account/deletion-check', 'GET', undefined, a.accessToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ canRequest: false, unsettledSplits: 2, fixedCostsWithOthers: 2 })
  })

  it('何も残っていなければ申し込める', async () => {
    const a = await signUp('check_ok')
    expect(await (await call('auth/account/deletion-check', 'GET', undefined, a.accessToken)).json()).toEqual({ canRequest: true, unsettledSplits: 0, fixedCostsWithOthers: 0 })
  })

  it('未認証は401', async () => {
    expect((await call('auth/account/deletion-check', 'GET')).status).toBe(401)
  })
})

describe('POST /api/auth/account/deletion', () => {
  it('申し込むとログイン・トークン更新・通常APIが使えなくなり、30日後の削除予定日を返す', async () => {
    const a = await signUp('request')
    const res = await requestDeletion(a.accessToken)
    expect(res.status).toBe(200)
    const { deletionScheduledAt } = await res.json<{ deletionScheduledAt: string }>()
    expect(Math.abs(new Date(deletionScheduledAt).getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000)

    expect((await call('auth/me', 'GET', undefined, a.accessToken)).status).toBe(401)
    expect((await call('auth/refresh', 'POST', { refreshToken: a.refreshToken })).status).toBe(401)
    const login = await call('auth/login', 'POST', { email: a.email, password: PASSWORD })
    expect(login.status).toBe(403)
    expect(await login.json()).toMatchObject({ code: 'ACCOUNT_DELETION_PENDING', details: [{ field: 'deletionScheduledAt', reason: deletionScheduledAt }] })
  })

  it('現在のパスワードが違うときは400で申し込まない', async () => {
    const a = await signUp('wrong')
    const res = await requestDeletion(a.accessToken, 'WrongPass1')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', message: '現在のパスワードが正しくありません' })
    expect((await call('auth/me', 'GET', undefined, a.accessToken)).status).toBe(200)
  })

  it('未精算の割り勘が残っていると409で申し込めない', async () => {
    const a = await signUp('blocked_a')
    const b = await signUp('blocked_b')
    const h = await createHousehold(a.id, b.id)
    await insertSplit(await insertExpense(h.id, b.id, h.categoryId), a.id, 'payment_reported')
    const res = await requestDeletion(a.accessToken)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'RESOURCE_CONFLICT', details: expect.arrayContaining([{ field: 'unsettledSplits', reason: '1' }]) })
    expect((await call('auth/me', 'GET', undefined, a.accessToken)).status).toBe(200)
  })

  it('未認証は401', async () => {
    expect((await call('auth/account/deletion', 'POST', { currentPassword: PASSWORD })).status).toBe(401)
  })
})

describe('POST /api/auth/account/deletion/cancel', () => {
  it('30日以内ならメールアドレスとパスワードで取り消し、そのままログインできる', async () => {
    const a = await signUp('cancel')
    await requestDeletion(a.accessToken)
    await backdate(a.id, 29)
    const res = await call('auth/account/deletion/cancel', 'POST', { email: a.email, password: PASSWORD })
    expect(res.status).toBe(200)
    const tokens = await res.json<{ accessToken: string; refreshToken: string }>()
    expect((await call('auth/me', 'GET', undefined, tokens.accessToken)).status).toBe(200)
    expect((await call('auth/login', 'POST', { email: a.email, password: PASSWORD })).status).toBe(200)
  })

  it('パスワードが違う・30日を過ぎた・申し込んでいないときは取り消せない', async () => {
    const a = await signUp('cancel_ng')
    expect((await call('auth/account/deletion/cancel', 'POST', { email: a.email, password: PASSWORD })).status).toBe(400)
    await requestDeletion(a.accessToken)
    expect((await call('auth/account/deletion/cancel', 'POST', { email: a.email, password: 'WrongPass1' })).status).toBe(401)
    await backdate(a.id, 31)
    expect((await call('auth/account/deletion/cancel', 'POST', { email: a.email, password: PASSWORD })).status).toBe(401)
    expect((await call('auth/login', 'POST', { email: a.email, password: PASSWORD })).status).toBe(401)
  })
})

describe('purgeExpiredAccounts', () => {
  it('30日を過ぎたアカウントの本人データを削除し、共有記録は「退会したユーザー」として残す', async () => {
    const a = await signUp('purge_a')
    const b = await signUp('purge_b')
    const h = await createHousehold(a.id, b.id)
    const account = await insertId('INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, 0)', h.id, a.id, '[E2E_TEST] Aの口座', 'bank')
    const card = await insertId('INSERT INTO cards (account_id, name) VALUES (?, ?)', account, '[E2E_TEST] Aのカード')
    await insertId('INSERT INTO card_charges (card_id, from_account_id, amount) VALUES (?, ?, 100)', card, account)
    const personalExpense = await insertExpense(h.id, a.id, h.categoryId, { accountId: account })
    const sharedExpense = await insertExpense(h.id, a.id, h.categoryId, { cardId: card })
    const settledSplit = await insertSplit(sharedExpense, b.id, 'settled')
    const bPaid = await insertExpense(h.id, b.id, h.categoryId)
    const bSplit = await insertSplit(bPaid, a.id, 'settled')
    await env.DB.prepare('UPDATE expense_splits SET debtor_account_id = ? WHERE id = ?').bind(account, bSplit).run()
    await insertId('INSERT INTO expense_split_comments (expense_split_id, author_user_id, body) VALUES (?, ?, ?)', settledSplit, a.id, '[E2E_TEST] コメント')
    await insertId('INSERT INTO incomes (household_id, earner_user_id, category_id, account_id, amount, content, income_date) VALUES (?, ?, ?, ?, 1000, ?, ?)', h.id, a.id, h.incomeCategoryId, account, '[E2E_TEST] 収入', '2030-01-01')
    await insertId('INSERT INTO fixed_costs (household_id, created_by_user_id, account_id, name, amount, payment_day) VALUES (?, ?, ?, ?, 1000, 1)', h.id, a.id, account, '[E2E_TEST] Aの共有固定費')
    const bFixed = await insertId('INSERT INTO fixed_costs (household_id, created_by_user_id, card_id, name, amount, payment_day) VALUES (?, ?, ?, ?, 1000, 1)', h.id, b.id, card, '[E2E_TEST] Bの固定費')
    const recipe = await insertId('INSERT INTO recipes (household_id, created_by_user_id, title) VALUES (?, ?, ?)', h.id, a.id, '[E2E_TEST] Aのレシピ')
    await insertId('INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date) VALUES (?, ?, ?, ?, ?)', h.id, a.id, a.id, '[E2E_TEST] 個人イベント', '2030-01-01')
    const sharedEvent = await insertId('INSERT INTO events (household_id, created_by_user_id, name, event_date) VALUES (?, ?, ?, ?)', h.id, a.id, '[E2E_TEST] 共有イベント', '2030-01-01')
    await env.DB.prepare("INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, '{}')").bind(a.id).run()
    await requestDeletion(a.accessToken)
    await backdate(a.id, 30)

    const result = await purgeExpiredAccounts(env.DB, new Date(Date.now() + 1000))
    expect(result.purged).toContain(a.id)

    const user = await env.DB.prepare('SELECT email, display_name, password_hash, deleted_at FROM users WHERE id = ?').bind(a.id).first<Record<string, string>>()
    expect(user).toMatchObject({ email: `deleted-${a.id}@deleted.invalid`, display_name: '退会したユーザー' })
    expect(user!.deleted_at).toBeTruthy()
    expect(user!.password_hash).not.toContain('pbkdf2')
    expect((await call('auth/login', 'POST', { email: a.email, password: PASSWORD })).status).toBe(401)

    expect(await count('SELECT COUNT(*) AS n FROM accounts WHERE owner_user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM cards WHERE id = ?', card)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM expenses WHERE id = ?', personalExpense)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM incomes WHERE earner_user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM fixed_costs WHERE created_by_user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE owner_user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?', a.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?', a.id)).toBe(0)

    // 共有記録は残り、本人の口座・カードへの参照は外れる
    expect(await env.DB.prepare('SELECT account_id, card_id FROM expenses WHERE id = ?').bind(sharedExpense).first()).toEqual({ account_id: null, card_id: null })
    expect(await count('SELECT COUNT(*) AS n FROM expense_splits WHERE id IN (?, ?)', settledSplit, bSplit)).toBe(2)
    expect(await env.DB.prepare('SELECT debtor_account_id FROM expense_splits WHERE id = ?').bind(bSplit).first()).toEqual({ debtor_account_id: null })
    expect(await count('SELECT COUNT(*) AS n FROM expense_split_comments WHERE author_user_id = ?', a.id)).toBe(1)
    expect(await env.DB.prepare('SELECT card_id FROM fixed_costs WHERE id = ?').bind(bFixed).first()).toEqual({ card_id: null })
    expect(await count('SELECT COUNT(*) AS n FROM recipes WHERE id = ?', recipe)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE id = ?', sharedEvent)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM households WHERE id = ?', h.id)).toBe(1)
    expect((await call('auth/me', 'GET', undefined, b.accessToken)).status).toBe(200)
  })

  it('最後のメンバーだった世帯は世帯ごと削除する', async () => {
    const a = await signUp('purge_solo')
    const h = await createHousehold(a.id)
    await insertId('INSERT INTO recipes (household_id, created_by_user_id, title) VALUES (?, ?, ?)', h.id, a.id, '[E2E_TEST] レシピ')
    await requestDeletion(a.accessToken)
    await backdate(a.id, 31)
    await purgeExpiredAccounts(env.DB, new Date())
    expect(await count('SELECT COUNT(*) AS n FROM households WHERE id = ?', h.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM recipes WHERE household_id = ?', h.id)).toBe(0)
  })

  it('30日に満たないアカウントと、取り消し期間中に未精算が増えたアカウントは削除しない', async () => {
    const young = await signUp('purge_young')
    await requestDeletion(young.accessToken)
    await backdate(young.id, 29)
    const a = await signUp('purge_skip_a')
    const b = await signUp('purge_skip_b')
    const h = await createHousehold(a.id, b.id)
    await requestDeletion(a.accessToken)
    await insertSplit(await insertExpense(h.id, b.id, h.categoryId), a.id, 'unpaid')
    await backdate(a.id, 40)

    const result = await purgeExpiredAccounts(env.DB, new Date())
    expect(result.purged).not.toContain(young.id)
    expect(result.purged).not.toContain(a.id)
    expect(result.skipped).toContain(a.id)
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?) AND deleted_at IS NULL', young.id, a.id)).toBe(2)
  })

  it('退会済みのメールアドレスで新しく登録できる', async () => {
    const a = await signUp('purge_reuse')
    await requestDeletion(a.accessToken)
    await backdate(a.id, 31)
    await purgeExpiredAccounts(env.DB, new Date())
    expect((await call('auth/register', 'POST', { email: a.email, password: PASSWORD, displayName: 'テスト再登録' })).status).toBe(201)
  })

  it('予約ドメインのアドレスは登録・メールアドレス変更で受け付けない', async () => {
    expect((await call('auth/register', 'POST', { email: 'deleted-1@Deleted.Invalid', password: PASSWORD, displayName: 'テスト' })).status).toBe(400)
    const a = await signUp('reserved')
    expect((await call('auth/email', 'PUT', { currentPassword: PASSWORD, newEmail: 'deleted-2@deleted.invalid' }, a.accessToken)).status).toBe(400)
  })

  it('削除の直前に未精算が増えても、削除は途中まで進まない', async () => {
    const a = await signUp('purge_race_a')
    const b = await signUp('purge_race_b')
    const h = await createHousehold(a.id, b.id)
    const account = await insertId('INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, 0)', h.id, a.id, '[E2E_TEST] 口座', 'bank')
    await requestDeletion(a.accessToken)
    await backdate(a.id, 31)
    // 対象の選定と削除バッチの間に、別のメンバーが割り勘を追加した状態を再現する。
    const racing = withBatchHook(async () => {
      await insertSplit(await insertExpense(h.id, b.id, h.categoryId), a.id, 'unpaid')
    })
    const result = await purgeExpiredAccounts(racing, new Date())
    expect(result.skipped).toContain(a.id)
    expect(await count('SELECT COUNT(*) AS n FROM accounts WHERE id = ?', account)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?', a.id)).toBe(1)
    expect(await env.DB.prepare('SELECT deleted_at, email FROM users WHERE id = ?').bind(a.id).first()).toEqual({ deleted_at: null, email: a.email })
  })

  it('選定の後に取り消し→再申し込みされたアカウントは、新しい申し込みの期限まで削除しない', async () => {
    const a = await signUp('purge_rerequest')
    await requestDeletion(a.accessToken)
    await backdate(a.id, 31)
    const rerequested = withBatchHook(async () => {
      await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').bind(new Date().toISOString(), a.id).run()
    })
    const result = await purgeExpiredAccounts(rerequested, new Date())
    expect(result.purged).not.toContain(a.id)
    expect(await env.DB.prepare('SELECT deleted_at FROM users WHERE id = ?').bind(a.id).first()).toEqual({ deleted_at: null })
  })

  it('1件の失敗で他のアカウントの削除は止まらない', async () => {
    const a = await signUp('purge_fail_a')
    const b = await signUp('purge_fail_b')
    for (const user of [a, b]) {
      await requestDeletion(user.accessToken)
      await backdate(user.id, 31)
    }
    // 前のテストで保留になったアカウントを対象から外し、a・bの2件だけにする。
    await env.DB.prepare('UPDATE users SET deletion_requested_at = NULL WHERE deleted_at IS NULL AND id NOT IN (?, ?)').bind(a.id, b.id).run()
    let calls = 0
    const flaky = withBatchHook(async () => {
      calls += 1
      if (calls === 1) throw new Error('[E2E_TEST] 一時的な失敗')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await purgeExpiredAccounts(flaky, new Date())
    log.mockRestore()
    expect([a.id, b.id].filter((id) => result.purged.includes(id))).toHaveLength(1)
    expect([a.id, b.id].filter((id) => result.skipped.includes(id))).toHaveLength(1)
  })
})

// D1のbatchの直前に処理を差し込む(並行操作や一時的な失敗の再現用)。
function withBatchHook(hook: () => Promise<void>): D1Database {
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          await hook()
          return target.batch(statements)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
