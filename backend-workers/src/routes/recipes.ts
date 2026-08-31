import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { recipes } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'レシピが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const recipeSchema = z.object({
  title: z.string().max(100).refine((value) => value.trim().length > 0, { message: 'タイトルを入力してください' }),
  ingredients: z.string().nullish(),
  steps: z.string().nullish(),
})

const favoriteSchema = z.object({
  isFavorite: z.boolean(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(recipe: typeof recipes.$inferSelect) {
  return {
    id: recipe.id,
    title: recipe.title,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    sourceType: recipe.sourceType,
    isFavorite: recipe.isFavorite,
  }
}

export const recipesRoute = new Hono<AppEnv>()

recipesRoute.use('*', requireAuth)

recipesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // レシピは世帯メンバー全員が自由に編集可能(common-notes.md 2章)なため、
  // 所有者チェックは行わず世帯所属のみを確認する(stores.tsと同じパターン)。
  const rows = await db.select().from(recipes).where(eq(recipes.householdId, householdId)).orderBy(recipes.id).all()
  return c.json(rows.map(toResponse))
})

recipesRoute.post('/', async (c) => {
  const parsed = recipeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const { title, ingredients, steps } = parsed.data
  const inserted = await db
    .insert(recipes)
    .values({
      householdId,
      createdByUserId: userId,
      title,
      ingredients: ingredients ?? null,
      steps: steps ?? null,
      sourceType: 'manual',
      isFavorite: false,
    })
    .returning()
    .get()

  return c.json(toResponse(inserted), 201)
})

recipesRoute.patch('/:id', async (c) => {
  const parsed = recipeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { title, ingredients, steps } = parsed.data
  await db
    .update(recipes)
    .set({ title, ingredients: ingredients ?? null, steps: steps ?? null })
    .where(eq(recipes.id, recipeId))

  return c.json(toResponse({ ...recipe, title, ingredients: ingredients ?? null, steps: steps ?? null }))
})

recipesRoute.patch('/:id/favorite', async (c) => {
  const parsed = favoriteSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { isFavorite } = parsed.data
  await db.update(recipes).set({ isFavorite }).where(eq(recipes.id, recipeId))

  return c.json(toResponse({ ...recipe, isFavorite }))
})

recipesRoute.delete('/:id', async (c) => {
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(recipes).where(eq(recipes.id, recipeId))

  return c.body(null, 204)
})
