import { and, eq } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, stores, zaikoCategories } from '../db/schema'
import { fromTenths, isOneDecimalPlace, MAX_VALUE, toTenths } from '../lib/decimal'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import { priceSchema } from '../lib/price'
import { inventoryShoppingSync } from '../lib/inventory-shopping-sync'
import { consumptionDate, consumptionDays, latestConsumptionDate } from '../lib/inventory-consumption'
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
  price: priceSchema,
  threshold: quantityValueSchema,
  dailyConsumption: quantityValueSchema.refine((value) => value > 0).nullable().optional(),
  autoConsumptionEnabled: z.boolean().optional(),
})

const updateItemSchema = z.object({
  price: priceSchema,
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '品名を入力してください' }),
  categoryId: z.number().int(),
  storeId: z.number().int().nullable(),
  threshold: quantityValueSchema,
  dailyConsumption: quantityValueSchema.refine((value) => value > 0).nullable().optional(),
  autoConsumptionEnabled: z.boolean().optional(),
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

// フロントエンドの normalizeKeyword(frontend/src/lib/keyword.ts)と同じ規則。カタカナはひらがなに揃える(#325)。
function normalizeName(name: string): string {
  return name.normalize('NFKC').toLowerCase().trim()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

// normalized_nameがNULLの既存行も含め、世帯内の品名をJSで比較する。
async function hasDuplicateName(db: DrizzleD1Database, householdId: number, name: string, excludeId?: number): Promise<boolean> {
  const normalizedName = normalizeName(name)
  const rows = await db.select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems).where(eq(inventoryItems.householdId, householdId)).all()
  return rows.some((row) => row.id !== excludeId && normalizeName(row.name) === normalizedName)
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

function toResponse(item: typeof inventoryItems.$inferSelect) {
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    storeId: item.storeId,
    quantity: fromTenths(item.quantityTenths),
    threshold: fromTenths(item.thresholdTenths),
    price: item.price,
    dailyConsumption: item.dailyConsumptionTenths === null ? null : fromTenths(item.dailyConsumptionTenths),
    autoConsumptionEnabled: item.autoConsumptionEnabled,
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
  const { name, categoryId, storeId, quantity, threshold, price } = parsed.data

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

  if (await hasDuplicateName(db, householdId, name)) {
    return c.json(errorResponse('DUPLICATE_INVENTORY_ITEM_NAME', '同じ品名の在庫が既に登録されています'), 409)
  }

  const daily = parsed.data.dailyConsumption == null ? null : toTenths(parsed.data.dailyConsumption)
  const enabled = parsed.data.autoConsumptionEnabled ?? (daily !== null)
  if (enabled && daily === null) {
    return c.json(errorResponse('VALIDATION_ERROR', '自動消費には1日の消費量が必要です'), 400)
  }
  const normalizedName = normalizeName(name)
  // Read last_insert_rowid() before the shopping INSERT changes it, in the same transaction.
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO inventory_items
      (household_id, name, normalized_name, category_id, store_id, price, quantity_tenths, threshold_tenths,
        daily_consumption_tenths, auto_consumption_enabled, last_consumed_on)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM inventory_items WHERE household_id = ? AND normalized_name = ?
      ) RETURNING id`).bind(householdId, name.trim(), normalizedName, categoryId, storeId, price ?? null,
        toTenths(quantity), toTenths(threshold), daily, enabled ? 1 : 0, consumptionDate(), householdId, normalizedName),
    ...inventoryShoppingSync(c.env.DB, null, householdId),
  ])
  const insertedId = (result[0].results[0] as { id: number } | undefined)?.id
  if (insertedId === undefined) {
    return c.json(errorResponse('DUPLICATE_INVENTORY_ITEM_NAME', '同じ品名の在庫が既に登録されています'), 409)
  }
  const inserted = await db.select().from(inventoryItems).where(eq(inventoryItems.id, insertedId)).get()
  if (!inserted) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)

  return c.json(toResponse(inserted), 201)
})

inventoryItemsRoute.patch('/:id', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = updateItemSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const itemId = Number(c.req.param('id'))
  const { name, categoryId, storeId, threshold, price } = parsed.data

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

  if (await hasDuplicateName(db, householdId, name, itemId)) {
    return c.json(errorResponse('DUPLICATE_INVENTORY_ITEM_NAME', '同じ品名の在庫が既に登録されています'), 409)
  }

  const normalizedName = normalizeName(name)
  // Settlement and setting changes are ONE conditional UPDATE. Retry stale snapshots.
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId))).get()
    if (!current) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    const daily = parsed.data.dailyConsumption === undefined ? current.dailyConsumptionTenths
      : parsed.data.dailyConsumption === null ? null : toTenths(parsed.data.dailyConsumption)
    const enabled = parsed.data.dailyConsumption === null
      ? false : parsed.data.autoConsumptionEnabled ?? current.autoConsumptionEnabled
    if ((enabled && daily === null) || (parsed.data.dailyConsumption === null && parsed.data.autoConsumptionEnabled === true)) {
      return c.json(errorResponse('VALIDATION_ERROR', '自動消費には1日の消費量が必要です'), 400)
    }
    const changed = daily !== current.dailyConsumptionTenths || enabled !== current.autoConsumptionEnabled
    const now = Date.now()
    const days = changed && current.autoConsumptionEnabled && current.lastConsumedOn
      ? consumptionDays(current.lastConsumedOn, latestConsumptionDate(now)) : 0
    const deduction = days * (current.dailyConsumptionTenths ?? 0)
    // New settings start tomorrow. Never move an already-future baseline backwards.
    const baseline = changed ? [current.lastConsumedOn ?? '', consumptionDate(now)].sort().at(-1)! : current.lastConsumedOn
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE inventory_items SET name = ?, normalized_name = ?, category_id = ?, store_id = ?,
        threshold_tenths = ?, ${price === undefined ? '' : 'price = ?,'} quantity_tenths = max(0, quantity_tenths - ?),
        daily_consumption_tenths = ?, auto_consumption_enabled = ?, last_consumed_on = ?, consumption_revision = ?
        WHERE id = ? AND household_id = ? AND consumption_revision = ? AND last_consumed_on IS ?
          AND NOT EXISTS (SELECT 1 FROM inventory_items AS duplicate WHERE duplicate.household_id = ?
            AND duplicate.normalized_name = ? AND duplicate.id <> ?) RETURNING id`)
        .bind(name.trim(), normalizedName, categoryId, storeId, toTenths(threshold), ...(price === undefined ? [] : [price]),
          deduction, daily, enabled ? 1 : 0, baseline, current.consumptionRevision + (changed ? 1 : 0),
          itemId, householdId, current.consumptionRevision, current.lastConsumedOn, householdId, normalizedName, itemId),
      ...inventoryShoppingSync(c.env.DB, itemId, householdId),
    ])
    if (results[0].meta.changes > 0) {
      const updated = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).get()
      if (!updated) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
      return c.json(toResponse(updated))
    }
    if (await hasDuplicateName(db, householdId, name, itemId)) {
      return c.json(errorResponse('DUPLICATE_INVENTORY_ITEM_NAME', '同じ品名の在庫が既に登録されています'), 409)
    }
  }
  return c.json(errorResponse('VALIDATION_ERROR', '他の操作と競合しました。再度保存してください'), 409)
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
  // read-modify-writeではなく、quantity_tenths + deltaを条件付きで直接UPDATEする1文にすることで、
  // 同時に複数のリクエストが同じアイテムの数量を増減させても、片方の更新が失われないようにする
  // (既存Java実装のupdateQuantity相当のSQLパターン)。範囲外ならWHERE句が0件マッチとなり
  // 更新が行われない(meta.changesで判定)。
  const [updateResult] = await c.env.DB.batch([c.env.DB.prepare(
    `UPDATE inventory_items
     SET quantity_tenths = quantity_tenths + ?
     WHERE id = ? AND household_id = ? AND quantity_tenths + ? >= 0 AND quantity_tenths + ? <= ?`,
  )
    .bind(deltaTenths, itemId, householdId, deltaTenths, deltaTenths, maxTenths),
    ...inventoryShoppingSync(c.env.DB, itemId, householdId),
  ])
  if (updateResult.meta.changes === 0) {
    return c.json(errorResponse('VALIDATION_ERROR', QUANTITY_OUT_OF_RANGE_MESSAGE), 400)
  }

  const updatedItem = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).get()
  if (!updatedItem) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  return c.json({ id: itemId, quantity: fromTenths(updatedItem.quantityTenths) })
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
