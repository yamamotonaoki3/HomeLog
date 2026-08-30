import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { expenses, kakeiboCategories } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'カテゴリーが見つかりません'
const IN_USE_MESSAGE = '使用中のカテゴリーは削除できません'
const DEFAULT_IMMUTABLE_MESSAGE = 'デフォルトカテゴリーは編集・削除できません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const DEFAULT_CATEGORY_NAMES = ['食費', '日用品', '交際費', '光熱費', '住居費', '通信費', '医療費', '趣味・娯楽', '固定費', 'その他']

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

export const kakeiboCategoriesRoute = new Hono<AppEnv>()

kakeiboCategoriesRoute.use('*', requireAuth)

kakeiboCategoriesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // カテゴリー名ごとにINSERT ... SELECT ... WHERE NOT EXISTSで冪等シードする
  // (Phase 3のzaiko-categoriesで確立したパターン。同時アクセス時の二重シードも防ぐ)。
  await c.env.DB.batch(
    DEFAULT_CATEGORY_NAMES.map((name) =>
      c.env.DB.prepare(
        `INSERT INTO kakeibo_categories (household_id, name, is_default)
         SELECT ?, ?, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM kakeibo_categories WHERE household_id = ? AND name = ? AND is_default = 1
         )`,
      ).bind(householdId, name, householdId, name),
    ),
  )

  const categories = await db.select().from(kakeiboCategories).where(eq(kakeiboCategories.householdId, householdId)).all()
  return c.json(categories.map((category) => ({ id: category.id, name: category.name, isDefault: category.isDefault })))
})

kakeiboCategoriesRoute.post('/', async (c) => {
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
    .insert(kakeiboCategories)
    .values({ householdId, name: parsed.data.name, isDefault: false })
    .returning()
    .get()

  return c.json({ id: inserted.id, name: inserted.name, isDefault: inserted.isDefault }, 201)
})

kakeiboCategoriesRoute.patch('/:id', async (c) => {
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
    .from(kakeiboCategories)
    .where(and(eq(kakeiboCategories.id, categoryId), eq(kakeiboCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  await db.update(kakeiboCategories).set({ name: parsed.data.name }).where(eq(kakeiboCategories.id, categoryId))

  return c.json({ id: category.id, name: parsed.data.name, isDefault: false })
})

kakeiboCategoriesRoute.delete('/:id', async (c) => {
  const categoryId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(kakeiboCategories)
    .where(and(eq(kakeiboCategories.id, categoryId), eq(kakeiboCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  const usage = await db.select().from(expenses).where(eq(expenses.categoryId, categoryId)).all()
  if (usage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }

  await db.delete(kakeiboCategories).where(eq(kakeiboCategories.id, categoryId))

  return c.body(null, 204)
})
