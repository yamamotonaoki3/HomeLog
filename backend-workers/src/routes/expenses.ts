import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cards, expenses, kakeiboCategories } from '../db/schema'
import { isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const CATEGORY_NOT_FOUND_MESSAGE = '指定されたカテゴリーが見つかりません'
const ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = '口座とカードは同時に指定できません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const INVALID_CARD_MESSAGE = '指定されたカードが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const AMOUNT_MAX = 9_999_999_999

const createExpenseSchema = z.object({
  expenseDate: z.string().refine(isValidCalendarDate, { message: '日付の形式が不正です' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  purpose: z.string().max(100).refine((value) => value.trim().length > 0, { message: '使用用途を入力してください' }),
  categoryId: z.number().int(),
  memo: z.string().max(255).nullish(),
  includeInHouseholdTotal: z.boolean().nullish(),
  accountId: z.number().int().nullish(),
  cardId: z.number().int().nullish(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(expense: typeof expenses.$inferSelect) {
  return {
    id: expense.id,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    purpose: expense.purpose,
    categoryId: expense.categoryId,
    memo: expense.memo,
    includeInHouseholdTotal: expense.includeInHouseholdTotal,
    accountId: expense.accountId,
    cardId: expense.cardId,
  }
}

export const expensesRoute = new Hono<AppEnv>()

expensesRoute.use('*', requireAuth)

expensesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const categoryIdParam = c.req.query('categoryId')
  const conditions = [eq(expenses.householdId, householdId), eq(expenses.payerUserId, userId)]
  if (categoryIdParam !== undefined) {
    conditions.push(eq(expenses.categoryId, Number(categoryIdParam)))
  }

  const rows = await db
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .all()

  return c.json(rows.map(toResponse))
})

expensesRoute.post('/', async (c) => {
  const parsed = createExpenseSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { expenseDate, amount, purpose, categoryId, memo, includeInHouseholdTotal, accountId, cardId } = parsed.data

  if (accountId != null && cardId != null) {
    return c.json(errorResponse('VALIDATION_ERROR', ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(kakeiboCategories)
    .where(and(eq(kakeiboCategories.id, categoryId), eq(kakeiboCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('VALIDATION_ERROR', CATEGORY_NOT_FOUND_MESSAGE), 400)
  }

  // 実際に支出行へ設定するaccount_id/card_id。creditカードが指定された場合は
  // (カード自体は残高を持たないため)親口座のIDをaccount_idに設定し、card_idはNULLのままにする
  // (既存Java実装のinsertExpenseForCardと同じ挙動)。
  let resolvedAccountId: number | null = null
  let resolvedCardId: number | null = null
  let balanceUpdateStatement: { table: 'accounts' | 'cards'; id: number } | null = null

  if (cardId != null) {
    const card = await db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_CARD_MESSAGE), 400)
    }
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, card.accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_CARD_MESSAGE), 400)
    }
    if (card.cardType === 'charge') {
      resolvedCardId = cardId
      balanceUpdateStatement = { table: 'cards', id: cardId }
    } else {
      resolvedAccountId = card.accountId
      balanceUpdateStatement = { table: 'accounts', id: card.accountId }
    }
  } else if (accountId != null) {
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
    }
    resolvedAccountId = accountId
    balanceUpdateStatement = { table: 'accounts', id: accountId }
  }

  // 「支出INSERT」+「(口座/カードが指定されていれば)残高の相対減算UPDATE」を1つのD1バッチ
  // (トランザクション)にまとめる(既存Javaの行ロックに代わる方式)。
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO expenses
         (household_id, payer_user_id, category_id, account_id, card_id, amount, purpose, memo, expense_date, include_in_household_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ).bind(
      householdId,
      userId,
      categoryId,
      resolvedAccountId,
      resolvedCardId,
      amount,
      purpose,
      memo ?? null,
      expenseDate,
      includeInHouseholdTotal ? 1 : 0,
    ),
  ]
  if (balanceUpdateStatement) {
    statements.push(
      c.env.DB
        .prepare(`UPDATE ${balanceUpdateStatement.table} SET balance = balance - ? WHERE id = ?`)
        .bind(amount, balanceUpdateStatement.id),
    )
  }

  const results = await c.env.DB.batch(statements)
  const insertedRow = results[0].results[0] as {
    id: number
    expense_date: string
    amount: number
    purpose: string
    category_id: number
    memo: string | null
    include_in_household_total: number
    account_id: number | null
    card_id: number | null
  }

  return c.json(
    {
      id: insertedRow.id,
      expenseDate: insertedRow.expense_date,
      amount: insertedRow.amount,
      purpose: insertedRow.purpose,
      categoryId: insertedRow.category_id,
      memo: insertedRow.memo,
      includeInHouseholdTotal: Boolean(insertedRow.include_in_household_total),
      accountId: insertedRow.account_id,
      cardId: insertedRow.card_id,
    },
    201,
  )
})
