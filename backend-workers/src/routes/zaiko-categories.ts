import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, zaikoCategories } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'カテゴリーが見つかりません'
const IN_USE_MESSAGE = '使用中のカテゴリーは削除できません'
const DEFAULT_IMMUTABLE_MESSAGE = 'デフォルトカテゴリーは編集・削除できません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const DEFAULT_CATEGORY_NAMES = ['野菜', '肉', '魚介', '乳製品', '卵', '調味料', '飲料', '冷凍食品', '乾物', 'その他']

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

export const zaikoCategoriesRoute = new Hono<AppEnv>()

zaikoCategoriesRoute.use('*', requireAuth)

zaikoCategoriesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 「カテゴリーが1件も無いか」ではなく「デフォルトカテゴリーが1件も無いか」で判定する。
  // GETより先にPOSTでカスタムカテゴリーが作られていた場合でも、デフォルト10件を
  // 取りこぼさずシードするため。
  const defaultExists = await db
    .select()
    .from(zaikoCategories)
    .where(and(eq(zaikoCategories.householdId, householdId), eq(zaikoCategories.isDefault, true)))
    .get()
  if (!defaultExists) {
    // 同時に複数リクエストがこの分岐に入っても20件・30件…と重複シードされないよう、
    // 各行を「その名前のデフォルトカテゴリーがまだ存在しない場合のみ挿入する」
    // INSERT ... SELECT ... WHERE NOT EXISTS の形にし、1つのバッチ(トランザクション)で実行する。
    // バッチ内は順に実行されるため、先に挿入された行は後続の文からも見える。
    await c.env.DB.batch(
      DEFAULT_CATEGORY_NAMES.map((name) =>
        c.env.DB.prepare(
          `INSERT INTO zaiko_categories (household_id, name, is_default)
           SELECT ?, ?, 1
           WHERE NOT EXISTS (
             SELECT 1 FROM zaiko_categories WHERE household_id = ? AND name = ? AND is_default = 1
           )`,
        ).bind(householdId, name, householdId, name),
      ),
    )
  }
  const categories = await db.select().from(zaikoCategories).where(eq(zaikoCategories.householdId, householdId)).all()

  return c.json(categories.map((category) => ({ id: category.id, name: category.name, isDefault: category.isDefault })))
})

zaikoCategoriesRoute.post('/', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = categoryNameSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const inserted = await db
    .insert(zaikoCategories)
    .values({ householdId, name: parsed.data.name, isDefault: false })
    .returning()
    .get()

  return c.json({ id: inserted.id, name: inserted.name, isDefault: inserted.isDefault }, 201)
})

zaikoCategoriesRoute.patch('/:id', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = categoryNameSchema.safeParse(body)
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
    .from(zaikoCategories)
    .where(and(eq(zaikoCategories.id, categoryId), eq(zaikoCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  await db.update(zaikoCategories).set({ name: parsed.data.name }).where(eq(zaikoCategories.id, categoryId))

  return c.json({ id: category.id, name: parsed.data.name, isDefault: false })
})

zaikoCategoriesRoute.delete('/:id', async (c) => {
  const categoryId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(zaikoCategories)
    .where(and(eq(zaikoCategories.id, categoryId), eq(zaikoCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (category.isDefault) {
    return c.json(errorResponse('VALIDATION_ERROR', DEFAULT_IMMUTABLE_MESSAGE), 400)
  }

  const usageCount = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.categoryId, categoryId))
    .all()
  if (usageCount.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }

  await db.delete(zaikoCategories).where(eq(zaikoCategories.id, categoryId))

  return c.body(null, 204)
})
