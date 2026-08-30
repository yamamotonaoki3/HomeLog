import { and, asc, eq, inArray } from 'drizzle-orm'
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

  // Phase 1: 全行の存在確認・範囲チェックを先に済ませる。まだ一切書き込みは行わない。
  // これにより、複数行のうち後ろの行が存在しない/範囲外だった場合に、既に処理済みの
  // 前方の行だけ反映されてしまう(購入処理が半端に成功する)ことを防ぐ
  // (既存Java実装の@Transactional相当の「全体が成功するか、何も変更しないか」を近似する)。
  const lines: {
    entry: typeof shoppingListItems.$inferSelect
    item: typeof inventoryItems.$inferSelect
    deltaTenths: number
  }[] = []
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
    lines.push({ entry, item, deltaTenths })
  }

  // Phase 2: 検証済みの全行を1つのD1バッチ(トランザクション)にまとめて実行する。
  // 個別にawaitして逐次コミットする方式だと、後方の行が(他リクエストとの競合で)
  // 実行時に失敗した場合、既に個別コミット済みの前方の行を取り消せない
  // (D1はバッチ以外に複数ラウンドトリップにまたがるトランザクションを提供しないため)。
  // 1つのバッチにまとめることで、全行が同一トランザクションとして実行される。
  // バッチはあらかじめ静的なbind値で文を組み立てる必要があり、ある文のRETURNING結果を
  // 後続の文のパラメータとして渡せないため、各行のDELETE/UPDATE文は「直前のUPDATEで
  // 実際に適用された値」をSQLのサブクエリ(ライブな現在値)で参照する形にし、
  // JS側の古いスナップショットに依存しないようにする。
  const statements: D1PreparedStatement[] = []
  for (const { entry, item, deltaTenths } of lines) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE inventory_items
         SET quantity_tenths = quantity_tenths + ?
         WHERE id = ? AND quantity_tenths + ? >= 0 AND quantity_tenths + ? <= ?`,
      ).bind(deltaTenths, item.id, deltaTenths, deltaTenths, maxTenths),
    )
    // 手動追加分は削除、自動追加分は直前のUPDATE後の実際の閾値判定結果をライブサブクエリで
    // 参照して削除するかを決める。どちらの場合も、まず「直前のUPDATEが実際に適用されたか」
    // (quantity_tenthsが期待した新しい値になっているか)をEXISTS句で確認し、他リクエストとの
    // 競合でUPDATEが不発(0件)だった場合は、手動・自動を問わずここで買い物リストを一切
    // 変更しない(在庫が変わっていないのに購入済み扱いで削除してしまう事故を防ぐ)。
    const expectedNewQuantityTenths = item.quantityTenths + deltaTenths
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

  // レスポンスは(JS側で計算した値ではなく)バッチ後に在庫アイテムを再取得した実際の値から組み立てる。
  const updatedItemIds = lines.map(({ item }) => item.id)
  const refreshedItems = await db.select().from(inventoryItems).where(inArray(inventoryItems.id, updatedItemIds)).all()
  const refreshedItemById = new Map(refreshedItems.map((refreshed) => [refreshed.id, refreshed]))

  const updatedInventoryItems: { id: number; quantity: number }[] = []
  const removedShoppingListItemIds: number[] = []
  for (const [index, { entry, item }] of lines.entries()) {
    const refreshed = refreshedItemById.get(item.id)
    if (refreshed) {
      updatedInventoryItems.push({ id: item.id, quantity: fromTenths(refreshed.quantityTenths) })
    }
    const deleteResult = results[index * 3 + 1]
    if (deleteResult.meta.changes > 0) {
      removedShoppingListItemIds.push(entry.id)
    }
  }

  return c.json({ updatedInventoryItems, removedShoppingListItemIds })
})
