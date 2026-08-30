import { and, asc, eq } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, shoppingListItems, stores, zaikoCategories } from '../db/schema'
import { fromTenths, isOneDecimalPlace, MAX_VALUE, toTenths } from '../lib/decimal'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '買い物リスト品目が見つかりません'
const ITEM_NOT_FOUND_MESSAGE = '指定された在庫アイテムが見つかりません'
const ALREADY_ADDED_MESSAGE = '既に買い物リストに追加されています'
const QUANTITY_OUT_OF_RANGE_MESSAGE = '在庫個数が範囲外です'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const createSchema = z.object({
  inventoryItemId: z.number().int(),
})

const purchaseLineSchema = z.object({
  id: z.number().int(),
  purchasedQuantity: z
    .number()
    .min(0)
    .max(MAX_VALUE)
    .refine(isOneDecimalPlace, { message: '数量は小数点第一位までで入力してください' }),
})

const processPurchaseSchema = z.object({
  items: z
    .array(purchaseLineSchema)
    .min(1)
    // 同じidが複数回指定されると、検証時に読んだ古い数量を元にした更新同士が競合し、
    // 一部の購入数量が反映されない結果になるため、重複を禁止する。
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: '同じ品目を複数回指定することはできません',
    }),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export const shoppingListItemsRoute = new Hono<AppEnv>()

shoppingListItemsRoute.use('*', requireAuth)

shoppingListItemsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const sortParam = c.req.query('sort')
  const orderColumn =
    sortParam === 'category' ? zaikoCategories.name : sortParam === 'store' ? stores.name : inventoryItems.name

  const rows = await db
    .select({
      id: shoppingListItems.id,
      inventoryItemId: shoppingListItems.inventoryItemId,
      name: inventoryItems.name,
      isManual: shoppingListItems.isManual,
      purchased: shoppingListItems.purchased,
      purchasedQuantityTenths: shoppingListItems.purchasedQuantityTenths,
    })
    .from(shoppingListItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, shoppingListItems.inventoryItemId))
    .innerJoin(zaikoCategories, eq(zaikoCategories.id, inventoryItems.categoryId))
    .leftJoin(stores, eq(stores.id, inventoryItems.storeId))
    .where(eq(shoppingListItems.householdId, householdId))
    .orderBy(asc(orderColumn), asc(inventoryItems.name))
    .all()

  return c.json(
    rows.map((row) => ({
      id: row.id,
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      isManual: row.isManual,
      purchased: row.purchased,
      purchasedQuantity: fromTenths(row.purchasedQuantityTenths),
    })),
  )
})

shoppingListItemsRoute.post('/', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { inventoryItemId } = parsed.data

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const item = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, inventoryItemId), eq(inventoryItems.householdId, householdId)))
    .get()
  if (!item) {
    return c.json(errorResponse('VALIDATION_ERROR', ITEM_NOT_FOUND_MESSAGE), 400)
  }

  const existing = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.inventoryItemId, inventoryItemId))
    .get()
  if (existing) {
    return c.json(errorResponse('VALIDATION_ERROR', ALREADY_ADDED_MESSAGE), 400)
  }

  // 事前チェックと挿入の間に同時に別リクエストが同じ在庫アイテムを追加した場合の競合を防ぐ
  // (shopping_list_items.inventory_item_idのUNIQUE制約を最終防衛線とする)。
  const inserted = await db
    .insert(shoppingListItems)
    .values({
      householdId,
      inventoryItemId,
      isManual: true,
      purchased: false,
      purchasedQuantityTenths: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get()
  if (!inserted) {
    return c.json(errorResponse('VALIDATION_ERROR', ALREADY_ADDED_MESSAGE), 400)
  }

  return c.json(
    {
      id: inserted.id,
      inventoryItemId: item.id,
      name: item.name,
      isManual: true,
      purchased: false,
      purchasedQuantity: 0,
    },
    201,
  )
})

shoppingListItemsRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  const entry = await db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.householdId, householdId)))
    .get()
  if (!entry) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(shoppingListItems).where(eq(shoppingListItems.id, id))

  return c.body(null, 204)
})

async function findOwnedEntry(db: DrizzleD1Database, householdId: number, id: number) {
  return db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.householdId, householdId)))
    .get()
}

shoppingListItemsRoute.post('/update', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = processPurchaseSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const maxTenths = toTenths(MAX_VALUE)

  // D1のbatchは各文を静的なbind値で事前に組み立てる必要があり、ある文のRETURNING結果を
  // 後続の文のパラメータとして使うことができない(プラットフォーム上の制約)。そのため、
  // 行ごとに「条件付き相対UPDATE(+RETURNINGで実際に適用された値を取得)」→
  // 「その実際の値を使って買い物リストの文を組み立てて実行」という2段階を順に行う。
  // 行内の2文はJS側の逐次awaitになるため、他リクエストの書き込みとまれに競合しうるが、
  // 常に「実際に適用された値」を根拠に判断するため、レスポンス・買い物リストの状態が
  // 実際の在庫数量と食い違うことはない(既存Java実装もupdateQuantity実行後に再度
  // findByIdで実際の値を読み直しており、同じ考え方)。
  const updatedInventoryItems: { id: number; quantity: number }[] = []
  const removedShoppingListItemIds: number[] = []

  for (const line of parsed.data.items) {
    const entry = await findOwnedEntry(db, householdId, line.id)
    if (!entry) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    }
    const item = await db.select().from(inventoryItems).where(eq(inventoryItems.id, entry.inventoryItemId)).get()
    if (!item) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    }

    const deltaTenths = toTenths(line.purchasedQuantity)
    const provisionalNewQuantityTenths = item.quantityTenths + deltaTenths
    if (provisionalNewQuantityTenths < 0 || provisionalNewQuantityTenths > maxTenths) {
      return c.json(errorResponse('VALIDATION_ERROR', QUANTITY_OUT_OF_RANGE_MESSAGE), 400)
    }

    const updateResult = await c.env.DB.prepare(
      `UPDATE inventory_items
       SET quantity_tenths = quantity_tenths + ?
       WHERE id = ? AND quantity_tenths + ? >= 0 AND quantity_tenths + ? <= ?
       RETURNING quantity_tenths, threshold_tenths`,
    )
      .bind(deltaTenths, item.id, deltaTenths, deltaTenths, maxTenths)
      .run()
    const updatedRow = updateResult.results[0] as { quantity_tenths: number; threshold_tenths: number } | undefined
    if (!updatedRow) {
      // 事前チェックの直後だが、他リクエストとの競合で直前に範囲外になっていた場合はここに来る。
      return c.json(errorResponse('VALIDATION_ERROR', QUANTITY_OUT_OF_RANGE_MESSAGE), 400)
    }
    updatedInventoryItems.push({ id: item.id, quantity: fromTenths(updatedRow.quantity_tenths) })

    // 手動追加分は無条件削除、自動追加分は実際に適用された値による閾値判定結果に基づいて
    // 削除するかを決める(JS側の古いスナップショットではなく、直前のUPDATEが返した実際の値を使う)。
    const stillBelowThreshold = updatedRow.quantity_tenths < updatedRow.threshold_tenths
    if (entry.isManual || !stillBelowThreshold) {
      const deleteResult = await db.delete(shoppingListItems).where(eq(shoppingListItems.id, entry.id)).run()
      if (deleteResult.meta.changes > 0) {
        removedShoppingListItemIds.push(entry.id)
      }
    } else {
      await db
        .update(shoppingListItems)
        .set({ purchased: false, purchasedQuantityTenths: 0 })
        .where(eq(shoppingListItems.id, entry.id))
    }
  }

  return c.json({ updatedInventoryItems, removedShoppingListItemIds })
})
