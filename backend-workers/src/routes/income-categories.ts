import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { incomeCategories, incomes } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'カテゴリーが見つかりません'
const IN_USE_MESSAGE = '使用中のカテゴリーは削除できません'
const DEFAULT_IMMUTABLE_MESSAGE = 'デフォルトカテゴリーは編集・削除できません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const DEFAULT_CATEGORY_NAMES = ['給与', 'ボーナス', '副業', '割り勘精算', 'その他']

const categoryNameSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: 'カテゴリー名を入力してください' }),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export const incomeCategoriesRoute = new Hono<AppEnv>()

incomeCategoriesRoute.use('*', requireAuth)

incomeCategoriesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  await c.env.DB.batch(
    DEFAULT_CATEGORY_NAMES.map((name) =>
      c.env.DB.prepare(
        `INSERT INTO income_categories (household_id, name, is_default)
         SELECT ?, ?, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM income_categories WHERE household_id = ? AND name = ? AND is_default = 1
         )`,
      ).bind(householdId, name, householdId, name),
    ),
  )

  const categories = await db.select().from(incomeCategories).where(eq(incomeCategories.householdId, householdId)).all()
  return c.json(categories.map((category) => ({ id: category.id, name: category.name, isDefault: category.isDefault })))
})

incomeCategoriesRoute.post('/', async (c) => {
  const parsed = categoryNameSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const inserted = await db
    .insert(incomeCategories)
    .values({ householdId, name: parsed.data.name, isDefault: false })
    .returning()
    .get()

  return c.json({ id: inserted.id, name: inserted.name, isDefault: inserted.isDefault }, 201)
})

incomeCategoriesRoute.patch('/:id', async (c) => {
  const parsed = categoryNameSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const categoryId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(incomeCategories)
    .where(and(eq(incomeCategories.id, categoryId), eq(incomeCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  await db.update(incomeCategories).set({ name: parsed.data.name }).where(eq(incomeCategories.id, categoryId))

  return c.json({ id: category.id, name: parsed.data.name, isDefault: false })
})

incomeCategoriesRoute.delete('/:id', async (c) => {
  const categoryId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(incomeCategories)
    .where(and(eq(incomeCategories.id, categoryId), eq(incomeCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  const usage = await db.select().from(incomes).where(eq(incomes.categoryId, categoryId)).all()
  if (usage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }

  await db.delete(incomeCategories).where(eq(incomeCategories.id, categoryId))

  return c.body(null, 204)
})
