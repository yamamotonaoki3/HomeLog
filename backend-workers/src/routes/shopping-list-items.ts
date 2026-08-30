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
  const lineContexts: { entryId: number; itemId: number; isManual: boolean }[] = []
  const statements: D1PreparedStatement[] = []

  // ここでの範囲チェックは「通常時に明らかに不正な値を早期に400で弾く」ための簡易チェック。
  // 実際の数量更新・閾値判定は、この時点で読んだ値(他リクエストの更新で古くなりうる)ではなく、
  // バッチ実行時にDB上の実際の値を見るSQLの条件・サブクエリに委ねることで、他リクエストとの
  // 競合によるレスポンスの不整合(古い値を元に組み立ててしまう等)を避ける。
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
    lineContexts.push({ entryId: entry.id, itemId: item.id, isManual: entry.isManual })

    // 条件付き相対更新(quantity_tenths + delta)+ RETURNINGで実際に適用された値を取得する。
    // items内のidの重複はスキーマのrefineで禁止しているため、同一在庫アイテムへの
    // 二重適用は起こらない。
    statements.push(
      c.env.DB.prepare(
        `UPDATE inventory_items
         SET quantity_tenths = quantity_tenths + ?
         WHERE id = ? AND quantity_tenths + ? >= 0 AND quantity_tenths + ? <= ?
         RETURNING quantity_tenths, threshold_tenths`,
      ).bind(deltaTenths, item.id, deltaTenths, deltaTenths, maxTenths),
    )
    // 手動追加分は無条件削除、自動追加分は上記UPDATE後の実際の閾値判定結果をサブクエリで
    // 参照して削除するかを決める(バッチ内で直前の文の後に実行されるため、最新の値を見られる)。
    // さらに、直前のUPDATEが範囲外で不発(0件)だった場合にこれらの文まで実行されて
    // しまわないよう、「quantity_tenthsが期待通りの新しい値になっているか」を
    // EXISTS句で確認し、実際に適用された場合のみ買い物リストを変更するようにする。
    const expectedNewQuantityTenths = provisionalNewQuantityTenths
    statements.push(
      c.env.DB
        .prepare(
          `DELETE FROM shopping_list_items
           WHERE id = ?
             AND EXISTS (SELECT 1 FROM inventory_items WHERE id = ? AND quantity_tenths = ?)
             AND (
               ? = 1
               OR NOT EXISTS (
                 SELECT 1 FROM inventory_items WHERE id = ? AND quantity_tenths < threshold_tenths
               )
             )`,
        )
        .bind(entry.id, item.id, expectedNewQuantityTenths, entry.isManual ? 1 : 0, item.id),
    )
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE shopping_list_items
           SET purchased = 0, purchased_quantity_tenths = 0
           WHERE id = ?
             AND EXISTS (SELECT 1 FROM inventory_items WHERE id = ? AND quantity_tenths = ?)
             AND ? = 0 AND EXISTS (
               SELECT 1 FROM inventory_items WHERE id = ? AND quantity_tenths < threshold_tenths
             )`,
        )
        .bind(entry.id, item.id, expectedNewQuantityTenths, entry.isManual ? 1 : 0, item.id),
    )
  }

  const results = await c.env.DB.batch(statements)

  const updatedInventoryItems: { id: number; quantity: number }[] = []
  const removedShoppingListItemIds: number[] = []
  for (const [index, ctx] of lineContexts.entries()) {
    const updateResult = results[index * 3]
    const deleteResult = results[index * 3 + 1]
    const updatedRow = updateResult.results[0] as { quantity_tenths: number } | undefined
    if (!updatedRow) {
      // 他リクエストとの競合で範囲外になった場合はここに来る。個別行のエラーとして扱い、
      // レスポンスの一覧には含めない(既に実行された他行への影響はない)。
      continue
    }
    updatedInventoryItems.push({ id: ctx.itemId, quantity: fromTenths(updatedRow.quantity_tenths) })
    if (deleteResult.meta.changes > 0) {
      removedShoppingListItemIds.push(ctx.entryId)
    }
  }

  return c.json({ updatedInventoryItems, removedShoppingListItemIds })
})
