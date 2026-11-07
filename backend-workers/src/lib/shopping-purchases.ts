import { z } from 'zod'
import { isOneDecimalPlace, MAX_VALUE, toTenths } from './decimal'
import { errorResponse } from './errors'

const conflictMessage = '買い物リストまたは在庫が変更されました。再取得してください'
const idSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const quantitySchema = z.number().min(0).max(MAX_VALUE).refine(isOneDecimalPlace)
const successSchema = z.object({
  requestId: z.string().uuid(),
  updatedInventoryItems: z.array(z.object({ id: idSchema, quantity: quantitySchema })),
  removedShoppingListItemIds: z.array(idSchema),
  remainingShoppingListItems: z.array(z.object({ id: idSchema, plannedQuantity: quantitySchema.refine(v => v > 0), purchaseRevision: revisionSchema })),
})
type PurchaseStatus = 200 | 400 | 404 | 409
type Result = { status: PurchaseStatus; body: unknown }
type Line = { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }
type Request = { requestId: string; items: Line[] }
type Scope = { householdId: number; actorUserId: number }
type Ledger = { request_json: string; response_status: number | null; response_json: string | null }
const pk = 'household_id = ? AND actor_user_id = ? AND request_id = ?'
const terminalDetail = [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }]
const requestUnique = 'UNIQUE constraint failed: shopping_purchase_requests.household_id, shopping_purchase_requests.actor_user_id, shopping_purchase_requests.request_id'
const isUnique = (error: unknown) => error instanceof Error && error.message.includes(requestUnique)

function normalize(body: unknown): Request | null {
  const parsed = z.object({ requestId: z.string().uuid(), items: z.array(z.object({
    id: z.number().refine(Number.isSafeInteger), purchasedQuantity: z.number(), expectedPurchaseRevision: z.number().refine(Number.isSafeInteger),
  })) }).safeParse(body)
  if (!parsed.success) return null
  return { requestId: parsed.data.requestId.toLowerCase(), items: parsed.data.items.map(({ id, purchasedQuantity, expectedPurchaseRevision }) => ({ id, purchasedQuantity, expectedPurchaseRevision })) }
}
function savedResult(row: Ledger, request: Request, requestJson: string): Result {
  if (row.request_json !== requestJson) return { status: 409, body: errorResponse('SHOPPING_PURCHASE_REQUEST_MISMATCH', '同じ購入要求IDで内容が変更されています。元の購入結果を確認してください', [{ field: 'requestId', reason: 'PAYLOAD_MISMATCH' }]) }
  if (!row.response_json) throw new Error('Incomplete shopping purchase result')
  const body: unknown = JSON.parse(row.response_json)
  if (row.response_status === 200) {
    const parsed = successSchema.safeParse(body)
    if (!parsed.success || parsed.data.requestId !== request.requestId) throw new Error('Invalid shopping purchase snapshot')
    const positive = request.items.filter(line => line.purchasedQuantity > 0)
    const expectedIds = new Set(positive.map(line => line.id))
    const completedIds = [...parsed.data.removedShoppingListItemIds, ...parsed.data.remainingShoppingListItems.map(line => line.id)]
    if (parsed.data.updatedInventoryItems.length !== positive.length ||
      new Set(parsed.data.updatedInventoryItems.map(line => line.id)).size !== positive.length ||
      completedIds.length !== positive.length || new Set(completedIds).size !== positive.length ||
      completedIds.some(id => !expectedIds.has(id)) ||
      parsed.data.remainingShoppingListItems.some(line => line.purchaseRevision !== request.items.find(item => item.id === line.id)!.expectedPurchaseRevision + 1)) {
      throw new Error('Inconsistent shopping purchase snapshot')
    }
  } else {
    const parsed = z.object({ code: z.string(), message: z.string(), details: z.array(z.object({ field: z.string(), reason: z.string() })) }).safeParse(body)
    const code = row.response_status === 400 ? 'VALIDATION_ERROR' : row.response_status === 404 ? 'RESOURCE_NOT_FOUND' : row.response_status === 409 ? 'RESOURCE_CONFLICT' : null
    if (!code || !parsed.success || parsed.data.code !== code || !parsed.data.details.some(d => d.field === 'purchase' && d.reason === 'PURCHASE_NOT_APPLIED')) throw new Error('Invalid shopping purchase rejection')
  }
  return { status: row.response_status as PurchaseStatus, body }
}
async function lookup(db: D1Database, scope: Scope, request: Request): Promise<Ledger | null> {
  return db.prepare(`SELECT request_json,response_status,response_json FROM shopping_purchase_requests WHERE ${pk}`)
    .bind(scope.householdId, scope.actorUserId, request.requestId).first<Ledger>()
}
/** Both successful and rejected attempts compete through the same ordinary PK INSERT.
 * Only a committed winner is terminal; a failed attempt or an absent lookup is not. */
async function reject(db: D1Database, scope: Scope, request: Request, requestJson: string, status: 400 | 404 | 409, message: string): Promise<Result> {
  const code = status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'RESOURCE_NOT_FOUND' : 'RESOURCE_CONFLICT'
  const body = errorResponse(code, message, terminalDetail)
  try {
    const row = await db.prepare(`INSERT INTO shopping_purchase_requests
      (household_id,actor_user_id,request_id,request_json,response_status,response_json)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM household_members WHERE household_id=? AND user_id=?)
      RETURNING request_json,response_status,response_json`)
      .bind(scope.householdId,scope.actorUserId,request.requestId,requestJson,status,JSON.stringify(body),scope.householdId,scope.actorUserId).first<Ledger>()
    if (!row) return { status: 404, body: errorResponse('RESOURCE_NOT_FOUND', '世帯グループが見つかりません') }
    return savedResult(row,request,requestJson)
  } catch (error) {
    if (!isUnique(error)) throw error
    const winner = await lookup(db,scope,request)
    if (!winner) throw new Error('Missing shopping purchase winner')
    return savedResult(winner,request,requestJson)
  }
}

export async function processShoppingPurchase(db: D1Database, scope: Scope, raw: unknown): Promise<Result> {
  const request = normalize(raw)
  if (!request) return { status:400, body:errorResponse('VALIDATION_ERROR','入力内容を確認してください') }
  const requestJson = JSON.stringify({ version:1,items:request.items })
  const existing = await lookup(db,scope,request)
  if (existing) return savedResult(existing,request,requestJson)
  const valid = request.items.length > 0 && new Set(request.items.map(l=>l.id)).size === request.items.length && request.items.every(l=>idSchema.safeParse(l.id).success && revisionSchema.safeParse(l.expectedPurchaseRevision).success && quantitySchema.safeParse(l.purchasedQuantity).success)
  if (!valid) return reject(db,scope,request,requestJson,400,'入力内容を確認してください')
  const lines: { entryId:number; itemId:number; revision:number; delta:number }[] = []
  for (const line of request.items) {
    const row = await db.prepare(`SELECT s.inventory_item_id,s.purchase_revision,i.quantity_tenths FROM shopping_list_items s
      JOIN inventory_items i ON i.id=s.inventory_item_id AND i.household_id=s.household_id WHERE s.id=? AND s.household_id=?`)
      .bind(line.id,scope.householdId).first<{inventory_item_id:number;purchase_revision:number;quantity_tenths:number}>()
    if (!row) return reject(db,scope,request,requestJson,404,'買い物リスト品目が見つかりません')
    if (row.purchase_revision !== line.expectedPurchaseRevision) return reject(db,scope,request,requestJson,409,conflictMessage)
    const delta=toTenths(line.purchasedQuantity)
    if (row.quantity_tenths+delta>999999) return reject(db,scope,request,requestJson,400,'在庫個数が範囲外です')
    lines.push({entryId:line.id,itemId:row.inventory_item_id,revision:line.expectedPurchaseRevision,delta})
  }
  const payload=JSON.stringify(lines)
  const requested=`SELECT CAST(key AS INTEGER) AS ordinal,json_extract(value,'$.entryId') AS entry_id,json_extract(value,'$.itemId') AS item_id,json_extract(value,'$.revision') AS revision,json_extract(value,'$.delta') AS delta FROM json_each(?)`
  const positiveIds=`SELECT entry_id FROM (${requested}) WHERE delta>0`
  const shouldRemove=`(s.planned_quantity_tenths<=r.delta AND (s.is_manual=1 OR i.quantity_tenths>i.threshold_tenths))`
  const positiveCount=lines.filter(l=>l.delta>0).length
  const scopeArgs=[scope.householdId,scope.actorUserId,request.requestId]
  const snapshotSql = `json_object('requestId',?,
      'updatedInventoryItems',json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id',i.id,'quantity',i.quantity_tenths/10.0) AS value FROM requested r JOIN inventory_items i ON i.id=r.item_id WHERE r.delta>0 ORDER BY r.ordinal))),
      'removedShoppingListItemIds',json((SELECT json_group_array(entry_id) FROM (SELECT r.entry_id FROM requested r LEFT JOIN shopping_list_items s ON s.id=r.entry_id WHERE r.delta>0 AND s.id IS NULL ORDER BY r.ordinal))),
      'remainingShoppingListItems',json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id',s.id,'plannedQuantity',s.planned_quantity_tenths/10.0,'purchaseRevision',s.purchase_revision) AS value FROM requested r JOIN shopping_list_items s ON s.id=r.entry_id WHERE r.delta>0 ORDER BY r.ordinal))))`
  const statements=[
    db.prepare('INSERT INTO shopping_purchase_requests (household_id,actor_user_id,request_id,request_json) VALUES (?,?,?,?)').bind(...scopeArgs,requestJson),
    db.prepare(`UPDATE shopping_purchase_requests SET guard=CASE WHEN
      EXISTS(SELECT 1 FROM household_members WHERE household_id=? AND user_id=?) AND
      (SELECT COUNT(*) FROM (${requested}) r JOIN shopping_list_items s ON s.id=r.entry_id AND s.inventory_item_id=r.item_id AND s.household_id=?
        JOIN inventory_items i ON i.id=r.item_id AND i.household_id=s.household_id
        WHERE s.purchase_revision=r.revision AND (r.delta=0 OR s.purchase_revision<9007199254740991) AND i.quantity_tenths+r.delta BETWEEN 0 AND 999999) = ? THEN 1 ELSE 0 END WHERE ${pk}`)
      .bind(scope.householdId,scope.actorUserId,payload,scope.householdId,lines.length,...scopeArgs),
    db.prepare(`WITH requested AS (${requested}) UPDATE inventory_items SET quantity_tenths=quantity_tenths+(SELECT delta FROM requested WHERE item_id=inventory_items.id)
      WHERE household_id=? AND id IN (SELECT item_id FROM requested WHERE delta>0)` ).bind(payload,scope.householdId),
    db.prepare(`UPDATE shopping_purchase_requests SET guard=CASE WHEN changes()=? THEN 1 ELSE 0 END WHERE ${pk}`).bind(positiveCount,...scopeArgs),
    db.prepare(`WITH requested AS (${requested}) DELETE FROM shopping_list_items WHERE household_id=? AND id IN
      (SELECT s.id FROM requested r JOIN shopping_list_items s ON s.id=r.entry_id JOIN inventory_items i ON i.id=s.inventory_item_id WHERE r.delta>0 AND ${shouldRemove})`).bind(payload,scope.householdId),
    // A trigger ignoring DELETE must not silently convert a complete purchase to a remaining row.
    db.prepare(`SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM (${requested}) r JOIN shopping_list_items s ON s.id=r.entry_id JOIN inventory_items i ON i.id=s.inventory_item_id WHERE r.delta>0 AND ${shouldRemove}) THEN '{}' ELSE '__invalid_purchase_delete__' END)`).bind(payload),
    db.prepare(`WITH requested AS (${requested}) UPDATE shopping_list_items SET
      planned_quantity_explicit=CASE WHEN planned_quantity_tenths>(SELECT delta FROM requested WHERE entry_id=shopping_list_items.id) THEN 1 ELSE 0 END,
      planned_quantity_tenths=CASE WHEN planned_quantity_tenths>(SELECT delta FROM requested WHERE entry_id=shopping_list_items.id) THEN planned_quantity_tenths-(SELECT delta FROM requested WHERE entry_id=shopping_list_items.id) ELSE 10 END,
      purchase_revision=purchase_revision+1,purchased=0,purchased_quantity_tenths=0
      WHERE household_id=? AND id IN (${positiveIds})`).bind(payload,scope.householdId,payload),
    db.prepare(`UPDATE shopping_purchase_requests SET guard=CASE WHEN changes()=(SELECT COUNT(*) FROM shopping_list_items WHERE household_id=? AND id IN (${positiveIds})) THEN 1 ELSE 0 END WHERE ${pk}`).bind(scope.householdId,payload,...scopeArgs),
    db.prepare(`WITH requested AS (${requested}) UPDATE shopping_purchase_requests SET response_status=200,response_json=${snapshotSql} WHERE ${pk}`).bind(payload,request.requestId,...scopeArgs),
    // This must immediately follow response UPDATE: JS validation cannot undo a committed batch.
    db.prepare(`WITH requested AS (${requested}), saved AS (SELECT response_status,response_json FROM shopping_purchase_requests WHERE ${pk}) SELECT json(CASE WHEN changes()=1 AND (SELECT COUNT(*) FROM saved)=1 AND (SELECT response_status FROM saved)=200 AND (SELECT response_json FROM saved)=${snapshotSql} THEN (SELECT response_json FROM saved) ELSE '__invalid_shopping_purchase_snapshot__' END) AS response_json`).bind(payload,...scopeArgs,request.requestId),
  ]
  try {
    const result=await db.batch<{response_json:string}>(statements)
    const final=result[result.length-1].results[0]
    if(!final)throw new Error('Missing shopping purchase snapshot')
    return savedResult({request_json:requestJson,response_status:200,response_json:final.response_json},request,requestJson)
  } catch(error) {
    if(isUnique(error)){
      const winner=await lookup(db,scope,request)
      if(!winner)throw new Error('Missing shopping purchase winner')
      return savedResult(winner,request,requestJson)
    }
    if(error instanceof Error && error.message.includes('CHECK constraint failed: shopping_purchase_guard'))return reject(db,scope,request,requestJson,409,conflictMessage)
    throw error
  }
}
