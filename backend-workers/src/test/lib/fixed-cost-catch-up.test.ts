import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { postDueFixedCosts } from '../../lib/fixed-cost-posting'

// 固定費の取りこぼし回収(#396)。日付引数は「UTCのgetterで読むとJSTの年月日」になるDate。
const jst = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day))

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_splits'),
    env.DB.prepare('DELETE FROM fixed_cost_posting_suppressions'),
    env.DB.prepare('DELETE FROM fixed_cost_splits'),
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM fixed_costs'),
    env.DB.prepare('DELETE FROM accounts'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function setup(): Promise<{ userId: number; householdId: number }> {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind('catchup@example.com', 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `CODE${user!.id}00000000000`.slice(0, 16))
    .first<{ id: number }>()
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household!.id, user!.id).run()
  return { userId: user!.id, householdId: household!.id }
}

async function createFixedCost(params: {
  householdId: number
  userId: number
  name?: string
  amount?: number
  paymentDay: number
  effectiveFrom: string | null
  accountId?: number
}): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO fixed_costs (household_id, owner_user_id, created_by_user_id, account_id, name, amount, payment_day, include_in_household_total, effective_from)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 0, ?) RETURNING id`,
  )
    .bind(params.householdId, params.userId, params.accountId ?? null, params.name ?? '家賃', params.amount ?? 80000, params.paymentDay, params.effectiveFrom)
    .first<{ id: number }>()
  return row!.id
}

const expenses = () =>
  env.DB.prepare('SELECT purpose, amount, expense_date, fixed_cost_year_month FROM expenses ORDER BY id').all<{
    purpose: string
    amount: number
    expense_date: string
    fixed_cost_year_month: string
  }>()

beforeEach(async () => {
  await resetDb()
})

describe('取りこぼし回収: 今月の支払日を過ぎた未計上分', () => {
  it('支払日の処理が失敗していても、翌日以降の実行で今月分を1回だけ計上し、計上日は復旧日でなく支払日になる', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-20' })

    await postDueFixedCosts(env.DB, jst(2026, 8, 20))

    const rows = (await expenses()).results
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ purpose: '家賃', amount: 80000, expense_date: '2026-08-05', fixed_cost_year_month: '2026-08' })
  })

  it('支払日が今日より後の固定費はまだ計上しない', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 25, effectiveFrom: '2026-07-20' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('当日が支払日のものは従来どおり当日の日付で計上する', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 20, effectiveFrom: '2026-07-20' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results[0].expense_date).toBe('2026-08-20')
  })

  it('当日分と過去の未計上分を同じ実行でそれぞれの支払日付で計上する', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, name: '家賃', paymentDay: 5, effectiveFrom: '2026-07-01' })
    await createFixedCost({ householdId, userId, name: '保険', paymentDay: 20, effectiveFrom: '2026-07-01' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    const rows = (await expenses()).results.map((row) => [row.purpose, row.expense_date])
    expect(rows).toEqual([['家賃', '2026-08-05'], ['保険', '2026-08-20']])
  })

  it('口座残高は回収時に1回だけ減算する', async () => {
    const { userId, householdId } = await setup()
    const account = await env.DB.prepare('INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(householdId, userId, '口座', 'bank', 100000)
      .first<{ id: number }>()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01', accountId: account!.id })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    await postDueFixedCosts(env.DB, jst(2026, 8, 21))
    const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account!.id).first<{ balance: number }>()
    expect(row?.balance).toBe(20000)
  })

  it('割り勘設定つきの固定費も、回収時に内訳(未精算)を一緒に作る', async () => {
    const { userId, householdId } = await setup()
    const other = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
      .bind('catchup-other@example.com', 'dummy-hash', 'テスト花子')
      .first<{ id: number }>()
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(householdId, other!.id).run()
    const id = await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01' })
    await env.DB.prepare(
      `INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due) VALUES (?, ?, 'ratio', 50, 40000)`,
    ).bind(id, other!.id).run()
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    const splits = await env.DB.prepare('SELECT debtor_user_id, status, amount_due FROM expense_splits').all<{ debtor_user_id: number; status: string; amount_due: number }>()
    expect(splits.results).toEqual([{ debtor_user_id: other!.id, status: 'unpaid', amount_due: 40000 }])
  })
})

describe('取りこぼし回収: 二重計上の防止', () => {
  it('再実行しても二重に計上しない', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    await postDueFixedCosts(env.DB, jst(2026, 8, 21))
    expect((await expenses()).results).toHaveLength(1)
  })

  it('並行実行しても明細は1件で、残高も1回だけ反映する', async () => {
    const { userId, householdId } = await setup()
    const account = await env.DB.prepare('INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(householdId, userId, '口座', 'bank', 100000)
      .first<{ id: number }>()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01', accountId: account!.id })
    await Promise.all([postDueFixedCosts(env.DB, jst(2026, 8, 20)), postDueFixedCosts(env.DB, jst(2026, 8, 20)), postDueFixedCosts(env.DB, jst(2026, 8, 20))])
    expect((await expenses()).results).toHaveLength(1)
    const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?').bind(account!.id).first<{ balance: number }>()
    expect(row?.balance).toBe(20000)
  })

  it('手動で削除した月(計上抑止の記録あり)は復活させない', async () => {
    const { userId, householdId } = await setup()
    const id = await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01' })
    await env.DB.prepare('INSERT INTO fixed_cost_posting_suppressions (fixed_cost_id, year_month) VALUES (?, ?)').bind(id, '2026-08').run()
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('抑止は当月だけで、翌月の回収は妨げない', async () => {
    const { userId, householdId } = await setup()
    const id = await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-07-01' })
    await env.DB.prepare('INSERT INTO fixed_cost_posting_suppressions (fixed_cost_id, year_month) VALUES (?, ?)').bind(id, '2026-08').run()
    await postDueFixedCosts(env.DB, jst(2026, 9, 20))
    expect((await expenses()).results.map((row) => row.fixed_cost_year_month)).toEqual(['2026-09'])
  })
})

describe('取りこぼし回収: 登録・変更前へ遡及しない', () => {
  it('登録・変更した日の支払日は対象にしない(支払日の後に設定した場合)', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-08-05' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('登録・変更した日より前の支払日は対象にしない', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-08-18' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('登録・変更の翌日以降に迎えた支払日は対象にする', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: '2026-08-04' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results.map((row) => row.expense_date)).toEqual(['2026-08-05'])
  })

  it('履歴のない行(effective_from が NULL)は回収せず、従来どおり当日分だけ計上する', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 5, effectiveFrom: null })
    await postDueFixedCosts(env.DB, jst(2026, 8, 20))
    expect((await expenses()).results).toHaveLength(0)
    await postDueFixedCosts(env.DB, jst(2026, 8, 5))
    expect((await expenses()).results).toHaveLength(1)
  })
})

describe('取りこぼし回収: 月境界と短い月', () => {
  it('過去月は補填せず、月が替わったら新しい月の分だけを対象にする', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 28, effectiveFrom: '2026-07-01' })
    await postDueFixedCosts(env.DB, jst(2026, 9, 1))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('月末(31日)払いで短い月の月末の実行に失敗しても、月が替わった後は過去月を補填しない', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 31, effectiveFrom: '2026-01-01' })
    await postDueFixedCosts(env.DB, jst(2026, 3, 1))
    expect((await expenses()).results).toHaveLength(0)
  })

  it('支払日が31日でも、30日までの月は月末(30日)を支払日として扱う', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 31, effectiveFrom: '2026-03-01' })
    await postDueFixedCosts(env.DB, jst(2026, 4, 30))
    expect((await expenses()).results.map((row) => row.expense_date)).toEqual(['2026-04-30'])
  })

  it('2月の月末払いの固定費は2月28日の実行で計上する(うるう年でない年)', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 30, effectiveFrom: '2026-01-01' })
    await postDueFixedCosts(env.DB, jst(2026, 2, 28))
    expect((await expenses()).results.map((row) => row.expense_date)).toEqual(['2026-02-28'])
  })

  it('前月に設定した固定費は、今月の支払日を過ぎていれば今月分だけ回収する', async () => {
    const { userId, householdId } = await setup()
    await createFixedCost({ householdId, userId, paymentDay: 10, effectiveFrom: '2026-07-25' })
    await postDueFixedCosts(env.DB, jst(2026, 8, 12))
    expect((await expenses()).results.map((row) => [row.expense_date, row.fixed_cost_year_month])).toEqual([['2026-08-10', '2026-08']])
  })
})
