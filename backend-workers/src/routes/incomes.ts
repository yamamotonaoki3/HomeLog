import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { incomeCategories, incomes } from '../db/schema'
import { isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { parseOptionalIntQueryParam } from '../lib/query-params'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const CATEGORY_NOT_FOUND_MESSAGE = '指定されたカテゴリーが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const AMOUNT_MAX = 9_999_999_999

const createIncomeSchema = z.object({
  incomeDate: z.string().refine(isValidCalendarDate, { message: '日付の形式が不正です' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  content: z.string().max(100).refine((value) => value.trim().length > 0, { message: '内容を入力してください' }),
  categoryId: z.number().int(),
  memo: z.string().max(255).nullish(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(income: typeof incomes.$inferSelect) {
  return {
    id: income.id,
    incomeDate: income.incomeDate,
    amount: income.amount,
    content: income.content,
    categoryId: income.categoryId,
    memo: income.memo,
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
    .select()
    .from(incomes)
    .where(and(...conditions))
    .orderBy(desc(incomes.incomeDate), desc(incomes.id))
    .all()

  return c.json(rows.map(toResponse))
})

incomesRoute.post('/', async (c) => {
  const parsed = createIncomeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { incomeDate, amount, content, categoryId, memo } = parsed.data

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

  const inserted = await db
    .insert(incomes)
    .values({ householdId, earnerUserId: userId, categoryId, amount, content, memo: memo ?? null, incomeDate })
    .returning()
    .get()

  return c.json(toResponse(inserted), 201)
})
