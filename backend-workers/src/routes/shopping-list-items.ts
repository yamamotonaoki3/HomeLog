import { and, asc, eq } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, shoppingListItems, stores, zaikoCategories } from '../db/schema'
import { fromTenths, isOneDecimalPlace, MAX_VALUE, toTenths } from '../lib/decimal'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import { priceSchema } from '../lib/price'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '買い物リスト品目が見つかりません'
const ITEM_NOT_FOUND_MESSAGE = '指定された在庫アイテムが見つかりません'
const ALREADY_ADDED_MESSAGE = '既に買い物リストに追加されています'
const QUANTITY_OUT_OF_RANGE_MESSAGE = '在庫個数が範囲外です'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const createSchema = z.object({
  inventoryItemId: z.number().int(),
  price: priceSchema,
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
      price: inventoryItems.price,
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
      price: row.price,
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
  const { inventoryItemId, price } = parsed.data

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
  // INSERTのUNIQUE違反でバッチ全体をロールバックし、競合の敗者がpriceを更新しない。
  // ON CONFLICT DO NOTHINGでは後続のUPDATEだけが成功してしまう。
  const statements = [c.env.DB.prepare(
    `INSERT INTO shopping_list_items
       (household_id, inventory_item_id, is_manual, purchased, purchased_quantity_tenths)
     VALUES (?, ?, 1, 0, 0) RETURNING id`,
  ).bind(householdId, inventoryItemId)]
  if (price !== undefined) {
    statements.push(c.env.DB.prepare('UPDATE inventory_items SET price = ? WHERE id = ? AND household_id = ?')
      .bind(price, inventoryItemId, householdId))
  }
  let insertedId: number
  try {
    const results = await c.env.DB.batch<{ id: number }>(statements)
    insertedId = results[0].results[0].id
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: shopping_list_items.inventory_item_id')) {
      return c.json(errorResponse('VALIDATION_ERROR', ALREADY_ADDED_MESSAGE), 400)
    }
    throw error
  }
  const currentItem = await db.select().from(inventoryItems).where(eq(inventoryItems.id, inventoryItemId)).get()

  return c.json(
    {
      id: insertedId,
      inventoryItemId: item.id,
      name: item.name,
      price: currentItem!.price,
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

  // Phase 2: 更新前の適格行を固定し、全行が適格な場合だけ1文で在庫を更新する。
  // 個別UPDATEの0件はSQL例外にならないため、batchに並べるだけでは部分確定を防げない。
  // 購入専用revisionを確認し、Cronの数量変更を許容しつつ並行購入の二重加算を防ぐ。
  const payload = JSON.stringify(lines.map(({ entry, item, deltaTenths }) => ({
    entryId: entry.id, itemId: item.id, purchaseRevision: entry.purchaseRevision, deltaTenths,
  })))
  const count = lines.length
  const entryIds = 'SELECT json_extract(value, \'$.entryId\') FROM json_each(?)'
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`WITH requested AS (
        SELECT json_extract(value, '$.entryId') AS entry_id,
          json_extract(value, '$.itemId') AS item_id,
          json_extract(value, '$.purchaseRevision') AS purchase_revision,
          json_extract(value, '$.deltaTenths') AS delta_tenths FROM json_each(?)
      ), eligible AS MATERIALIZED (
        SELECT i.id, r.delta_tenths FROM requested r
        JOIN shopping_list_items s ON s.id = r.entry_id AND s.inventory_item_id = r.item_id AND s.household_id = ?
        JOIN inventory_items i ON i.id = s.inventory_item_id AND i.household_id = ?
        WHERE s.purchase_revision = r.purchase_revision AND i.quantity_tenths + r.delta_tenths BETWEEN 0 AND ?
      )
      UPDATE inventory_items SET quantity_tenths = quantity_tenths + (SELECT delta_tenths FROM eligible WHERE eligible.id = inventory_items.id)
      WHERE id IN (SELECT id FROM eligible) AND (SELECT COUNT(*) FROM eligible) = ?
      RETURNING id, quantity_tenths`).bind(payload, householdId, householdId, maxTenths, count),
    // changes()は直前の文の更新件数。全品目が更新された時だけ入力をリセットする。
    c.env.DB.prepare(`UPDATE shopping_list_items SET purchased = 0, purchased_quantity_tenths = 0, purchase_revision = purchase_revision + 1
      WHERE household_id = ? AND id IN (${entryIds}) AND changes() = ?`).bind(householdId, payload, count),
    c.env.DB.prepare(`DELETE FROM shopping_list_items
      WHERE household_id = ? AND id IN (${entryIds}) AND changes() = ? AND
        (is_manual = 1 OR EXISTS (SELECT 1 FROM inventory_items WHERE id = shopping_list_items.inventory_item_id AND quantity_tenths > threshold_tenths))
      RETURNING id`).bind(householdId, payload, count),
  ])
  if (results[0].meta.changes !== count) {
    return c.json(errorResponse('RESOURCE_CONFLICT', '買い物リストまたは在庫が変更されました。再取得してください'), 409)
  }

  // 別要求の変更を混ぜず、この購入バッチの確定結果を元の要求順で返す。
  const updatedById = new Map((results[0].results as { id: number; quantity_tenths: number }[])
    .map((row) => [row.id, row.quantity_tenths]))
  const removedIds = new Set((results[2].results as { id: number }[]).map((row) => row.id))
  const updatedInventoryItems = lines.map(({ item }) => ({ id: item.id, quantity: fromTenths(updatedById.get(item.id)!) }))
  const removedShoppingListItemIds = lines.filter(({ entry }) => removedIds.has(entry.id)).map(({ entry }) => entry.id)

  return c.json({ updatedInventoryItems, removedShoppingListItemIds })
})
