import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { menuEntries, recipes } from '../db/schema'
import { isMonday } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '献立が見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const WEEK_START_DATE_NOT_MONDAY_MESSAGE = '週の開始日は月曜日を指定してください'
const RECIPE_OR_MEMO_REQUIRED_MESSAGE = 'レシピまたは自由メモのどちらか一方を指定してください'
const INVALID_RECIPE_MESSAGE = '指定されたレシピが見つかりません'

const createMenuEntrySchema = z
  .object({
    weekStartDate: z.string().refine(isMonday, { message: WEEK_START_DATE_NOT_MONDAY_MESSAGE }),
    recipeId: z.number().int().nullish(),
    // 空白だけの自由メモは「内容の無いラフ登録」になってしまうため、
    // recipes.tsのtitleバリデーションと同様にトリム後の非空をrefineで確認する。
    freeTextMemo: z
      .string()
      .max(100)
      .refine((value) => value.trim().length > 0, { message: 'メモを入力してください' })
      .nullish(),
  })
  // recipeIdとfreeTextMemoは、確定登録(レシピ選択)とラフ登録(自由メモ)のどちらか一方のみを
  // 許可するための排他チェック(F10_kondate_menu.md 4章)。
  .refine((value) => (value.recipeId != null) !== (value.freeTextMemo != null), {
    message: RECIPE_OR_MEMO_REQUIRED_MESSAGE,
  })

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(entry: typeof menuEntries.$inferSelect) {
  return {
    id: entry.id,
    recipeId: entry.recipeId,
    freeTextMemo: entry.freeTextMemo,
    weekStartDate: entry.weekStartDate,
  }
}

export const menuEntriesRoute = new Hono<AppEnv>()

menuEntriesRoute.use('*', requireAuth)

menuEntriesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const weekStartDate = c.req.query('weekStartDate')
  if (!weekStartDate || !isMonday(weekStartDate)) {
    return c.json(errorResponse('VALIDATION_ERROR', WEEK_START_DATE_NOT_MONDAY_MESSAGE), 400)
  }

  // 献立表は世帯メンバー全員が自由に編集可能(common-notes.md 2章)なため、
  // 所有者チェックは行わず世帯所属のみを確認する(recipes.ts/stores.tsと同じパターン)。
  const rows = await db
    .select()
    .from(menuEntries)
    .where(and(eq(menuEntries.householdId, householdId), eq(menuEntries.weekStartDate, weekStartDate)))
    .orderBy(menuEntries.id)
    .all()

  return c.json(rows.map(toResponse))
})

menuEntriesRoute.post('/', async (c) => {
  const parsed = createMenuEntrySchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const { weekStartDate, recipeId, freeTextMemo } = parsed.data

  if (recipeId != null) {
    // 確定登録(レシピ選択)の場合、そのレシピが同じ世帯のものであることを確認する
    // (他世帯のレシピIDを指定されても紐付けられないようにする)。
    const recipe = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .get()
    if (!recipe) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_RECIPE_MESSAGE), 400)
    }
  }

  const inserted = await db
    .insert(menuEntries)
    .values({
      householdId,
      recipeId: recipeId ?? null,
      freeTextMemo: freeTextMemo ?? null,
      weekStartDate,
    })
    .returning()
    .get()

  return c.json(toResponse(inserted), 201)
})

menuEntriesRoute.delete('/:id', async (c) => {
  const entryId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const entry = await db
    .select()
    .from(menuEntries)
    .where(and(eq(menuEntries.id, entryId), eq(menuEntries.householdId, householdId)))
    .get()
  if (!entry) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(menuEntries).where(eq(menuEntries.id, entryId))

  return c.body(null, 204)
})
