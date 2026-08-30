import { and, eq } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, shoppingListItems, stores, zaikoCategories } from '../db/schema'
import { fromTenths, isOneDecimalPlace, MAX_VALUE, toTenths } from '../lib/decimal'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '在庫アイテムが見つかりません'
const CATEGORY_NOT_FOUND_MESSAGE = '指定されたカテゴリーが見つかりません'
const STORE_NOT_FOUND_MESSAGE = '指定された店舗が見つかりません'
const QUANTITY_OUT_OF_RANGE_MESSAGE = '在庫個数が範囲外です'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const quantityValueSchema = z
  .number()
  .min(0)
  .max(MAX_VALUE)
  .refine(isOneDecimalPlace, { message: '数量は小数点第一位までで入力してください' })

const createItemSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '品名を入力してください' }),
  categoryId: z.number().int(),
  storeId: z.number().int().nullable(),
  quantity: quantityValueSchema,
  threshold: quantityValueSchema,
})

const updateItemSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '品名を入力してください' }),
  categoryId: z.number().int(),
  storeId: z.number().int().nullable(),
  threshold: quantityValueSchema,
})

// deltaは負数も許容するため0以上の制約は付けない(±の増減幅)。
const quantityAdjustSchema = z.object({
  delta: z
    .number()
    .min(-MAX_VALUE)
    .max(MAX_VALUE)
    .refine(isOneDecimalPlace, { message: '数量は小数点第一位までで入力してください' }),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

async function validateCategory(db: DrizzleD1Database, householdId: number, categoryId: number): Promise<boolean> {
  const category = await db
    .select()
    .from(zaikoCategories)
    .where(and(eq(zaikoCategories.id, categoryId), eq(zaikoCategories.householdId, householdId)))
    .get()
  return category !== undefined
}

async function validateStore(db: DrizzleD1Database, householdId: number, storeId: number | null): Promise<boolean> {
  if (storeId === null) {
    return true
  }
  const store = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.householdId, householdId)))
    .get()
  return store !== undefined
}

/**
 * 在庫個数と閾値の関係に応じて買い物リストを同期する(既存Java実装のsyncShoppingListと同じロジック)。
 * 閾値未満かつ自動追加分が無ければ追加し、閾値以上になれば自動追加分のみ除外する
 * (手動追加分はここでは削除しない)。
 */
async function syncShoppingList(db: DrizzleD1Database, item: typeof inventoryItems.$inferSelect): Promise<void> {
  const belowThreshold = item.quantityTenths < item.thresholdTenths
  const autoEntry = await db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.inventoryItemId, item.id), eq(shoppingListItems.isManual, false)))
    .get()

  if (belowThreshold && !autoEntry) {
    await db.insert(shoppingListItems).values({
      householdId: item.householdId,
      inventoryItemId: item.id,
      isManual: false,
      purchased: false,
      purchasedQuantityTenths: 0,
    })
  } else if (!belowThreshold && autoEntry) {
    await db.delete(shoppingListItems).where(eq(shoppingListItems.id, autoEntry.id))
  }
}

function toResponse(item: typeof inventoryItems.$inferSelect) {
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    storeId: item.storeId,
    quantity: fromTenths(item.quantityTenths),
    threshold: fromTenths(item.thresholdTenths),
  }
}

export const inventoryItemsRoute = new Hono<AppEnv>()

inventoryItemsRoute.use('*', requireAuth)

inventoryItemsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const rows = await db.select().from(inventoryItems).where(eq(inventoryItems.householdId, householdId)).all()
  return c.json(rows.map(toResponse))
})

inventoryItemsRoute.post('/', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = createItemSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { name, categoryId, storeId, quantity, threshold } = parsed.data

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  if (!(await validateCategory(db, householdId, categoryId))) {
    return c.json(errorResponse('VALIDATION_ERROR', CATEGORY_NOT_FOUND_MESSAGE), 400)
  }
  if (!(await validateStore(db, householdId, storeId))) {
    return c.json(errorResponse('VALIDATION_ERROR', STORE_NOT_FOUND_MESSAGE), 400)
  }

  const inserted = await db
    .insert(inventoryItems)
    .values({
      householdId,
      name,
      categoryId,
      storeId,
      quantityTenths: toTenths(quantity),
      thresholdTenths: toTenths(threshold),
    })
    .returning()
    .get()
  await syncShoppingList(db, inserted)

  return c.json(toResponse(inserted), 201)
})

inventoryItemsRoute.patch('/:id', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = updateItemSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const itemId = Number(c.req.param('id'))
  const { name, categoryId, storeId, threshold } = parsed.data

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  const item = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)))
    .get()
  if (!item) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (!(await validateCategory(db, householdId, categoryId))) {
    return c.json(errorResponse('VALIDATION_ERROR', CATEGORY_NOT_FOUND_MESSAGE), 400)
  }
  if (!(await validateStore(db, householdId, storeId))) {
    return c.json(errorResponse('VALIDATION_ERROR', STORE_NOT_FOUND_MESSAGE), 400)
  }

  const thresholdTenths = toTenths(threshold)
  await db
    .update(inventoryItems)
    .set({ name, categoryId, storeId, thresholdTenths })
    .where(eq(inventoryItems.id, itemId))
  const updatedItem = { ...item, name, categoryId, storeId, thresholdTenths }
  await syncShoppingList(db, updatedItem)

  return c.json(toResponse(updatedItem))
})

inventoryItemsRoute.patch('/:id/quantity', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = quantityAdjustSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const itemId = Number(c.req.param('id'))
  const deltaTenths = toTenths(parsed.data.delta)

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  const item = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)))
    .get()
  if (!item) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const maxTenths = toTenths(MAX_VALUE)
  const newQuantityTenths = item.quantityTenths + deltaTenths
  if (newQuantityTenths < 0 || newQuantityTenths > maxTenths) {
    return c.json(errorResponse('VALIDATION_ERROR', QUANTITY_OUT_OF_RANGE_MESSAGE), 400)
  }

  await db.update(inventoryItems).set({ quantityTenths: newQuantityTenths }).where(eq(inventoryItems.id, itemId))
  const updatedItem = { ...item, quantityTenths: newQuantityTenths }
  await syncShoppingList(db, updatedItem)

  return c.json({ id: itemId, quantity: fromTenths(newQuantityTenths) })
})

inventoryItemsRoute.delete('/:id', async (c) => {
  const itemId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  const item = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)))
    .get()
  if (!item) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  // shopping_list_items.inventory_item_idはON DELETE CASCADEのため、在庫削除で自動的に連動削除される。
  await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId))

  return c.body(null, 204)
})
