import { and, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, incomeCategories, incomes } from '../db/schema'
import { isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { parseOptionalIntQueryParam } from '../lib/query-params'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'
import { balanceStatements, conflict, deleteLedger, ledgerArgs, ledgerWhere, loadMutableLedger } from '../lib/ledger-mutations'

const CATEGORY_NOT_FOUND_MESSAGE = '指定されたカテゴリーが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const AMOUNT_MAX = 9_999_999_999

const createIncomeSchema = z.object({
  incomeDate: z.string().refine(isValidCalendarDate, { message: '日付の形式が不正です' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  content: z.string().max(100).refine((value) => value.trim().length > 0, { message: '内容を入力してください' }),
  categoryId: z.number().int(),
  accountId: z.number().int().positive(),
  memo: z.string().max(255).nullish(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(income: typeof incomes.$inferSelect, accountName: string | null = null) {
  return {
    id: income.id,
    incomeDate: income.incomeDate,
    amount: income.amount,
    content: income.content,
    categoryId: income.categoryId,
    memo: income.memo,
    accountId: income.accountId,
    accountName,
  }
}

export const incomesRoute = new Hono<AppEnv>()

incomesRoute.use('*', requireAuth)

incomesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const categoryId = parseOptionalIntQueryParam(c.req.query('categoryId'))
  if (categoryId === null) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const conditions = [eq(incomes.householdId, householdId), eq(incomes.earnerUserId, userId)]
  if (categoryId !== undefined) {
    conditions.push(eq(incomes.categoryId, categoryId))
  }

  const rows = await db
    .select({ income: incomes, accountName: accounts.name })
    .from(incomes)
    // 削除済み口座も履歴の名前解決には使用する。閲覧権限は収入側で本人に限定する。
    .leftJoin(accounts, eq(incomes.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(desc(incomes.incomeDate), desc(incomes.id))
    .all()

  return c.json(rows.map(({ income, accountName }) => toResponse(income, accountName)))
})

incomesRoute.post('/', (c) => saveIncome(c))
incomesRoute.put('/:id', (c) => saveIncome(c, true))
incomesRoute.delete('/:id', (c) => deleteLedger(c, 'incomes'))

async function saveIncome(c: Context<AppEnv>, updating = false) {
  const ctx = updating ? await loadMutableLedger(c, 'incomes') : null
  if (ctx?.error) return ctx.error
  const parsed = createIncomeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { incomeDate, amount, content, categoryId, memo, accountId } = parsed.data

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(incomeCategories)
    .where(and(eq(incomeCategories.id, categoryId), eq(incomeCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('VALIDATION_ERROR', CATEGORY_NOT_FOUND_MESSAGE), 400)
  }

  const account = await db.select().from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId), isNull(accounts.deletedAt)))
    .get()
  if (!account) {
    return c.json(errorResponse('VALIDATION_ERROR', '指定された口座が見つかりません'), 400)
  }

  if (ctx && !ctx.error) {
    const { row, target } = ctx
    const args = ledgerArgs('incomes', row, householdId, userId)
    const statements = balanceStatements(c.env.DB, target, -row.amount, { table: 'accounts', id: accountId }, amount,
      `EXISTS (SELECT 1 FROM incomes WHERE ${ledgerWhere('incomes')})`, args)
    statements.push(c.env.DB.prepare(`UPDATE incomes SET income_date = ?, amount = ?, content = ?, category_id = ?, memo = ?, account_id = ?
      WHERE ${ledgerWhere('incomes')} RETURNING id`)
      .bind(incomeDate, amount, content, categoryId, memo ?? null, accountId, ...args))
    const results = await c.env.DB.batch(statements)
    if (!results[results.length - 1].results.length) return conflict(c)
    return c.json({ id: row.id, incomeDate, amount, content, categoryId, memo: memo ?? null, accountId, accountName: account.name })
  }


  // 相対加算と条件付きINSERTを同じトランザクションで実行する。
  // 事前照合後の削除などでUPDATEが0件なら、changes()によりINSERTも0件になる。
  // INSERT失敗時は先行した残高加算もロールバックされる。
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE accounts SET balance = balance + ?
      WHERE id = ? AND household_id = ? AND owner_user_id = ? AND deleted_at IS NULL`)
      .bind(amount, accountId, householdId, userId),
    c.env.DB.prepare(`INSERT INTO incomes
      (household_id, earner_user_id, category_id, account_id, amount, content, memo, income_date)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
      RETURNING id`)
      .bind(householdId, userId, categoryId, accountId, amount, content, memo ?? null, incomeDate),
  ])
  const row = results[1].results[0] as { id: number } | undefined
  if (!row) {
    return c.json(errorResponse('VALIDATION_ERROR', '指定された口座が見つかりません'), 400)
  }

  return c.json({ id: row.id, incomeDate, amount, content, categoryId, memo: memo ?? null, accountId, accountName: account.name }, 201)
}
