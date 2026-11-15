import { errorResponse } from './errors'

export type MenuScope = { householdId: number; actorUserId: number }
export type MenuResult = { status: number; body: unknown }
export type MenuLink = { id: number; recipeId: number | null; recipeTitle: string; usageQuantity: number; enabled: boolean; carryEnabled: boolean; revision: number }
export const menuRequestKey = 'household_id = ? AND actor_user_id = ? AND request_id = ?'
export function menuRequestBindings(scope: MenuScope, requestId: string) { return [scope.householdId, scope.actorUserId, requestId] as const }
export function menuConflict(): MenuResult {
  return { status: 409, body: errorResponse('RESOURCE_CONFLICT', '献立または在庫が変更されました。再取得してください') }
}
export function menuNotFound(): MenuResult { return { status: 404, body: errorResponse('RESOURCE_NOT_FOUND', '献立または在庫が見つかりません') } }
type Saved = { request_json: string; response_status: number; response_json: string }
async function lookup(db: D1Database, scope: MenuScope, id: string, json: string): Promise<MenuResult | null> {
  const row = await db.prepare('SELECT request_json,response_status,response_json FROM menu_operation_requests WHERE '+menuRequestKey).bind(...menuRequestBindings(scope,id)).first<Saved>()
  if (!row) return null
  if (row.request_json !== json) return {status:409,body:errorResponse('RESOURCE_CONFLICT','同じ操作要求IDで内容が変更されています',[{field:'requestId',reason:'PAYLOAD_MISMATCH'}])}
  if (![200,201].includes(row.response_status) || row.response_json === '{}') throw new Error('Incomplete menu operation result')
  return {status:row.response_status,body:JSON.parse(row.response_json) as unknown}
}
/** Call only after authentication and current household authorization, before entity/date/revision guards. */
export async function savedMenuOperation(db:D1Database,scope:MenuScope,id:string,json:string) {
  return lookup(db,scope,id,json)
}
export async function executeMenuOperation(db:D1Database,scope:MenuScope,id:string,json:string,build:()=>D1PreparedStatement[]):Promise<MenuResult> {
  const saved=await lookup(db,scope,id,json)
  if(saved)return saved
  try {
    await db.batch([
      db.prepare('INSERT INTO menu_operation_requests(household_id,actor_user_id,request_id,request_json,response_status,response_json) VALUES(?,?,?,?,0,?)').bind(...menuRequestBindings(scope,id),json,'{}'),
      ...build(),
      db.prepare('UPDATE menu_operation_requests SET guard=CASE WHEN response_status IN(200,201) AND json_valid(response_json) AND response_json <> ? THEN 1 ELSE 0 END WHERE '+menuRequestKey).bind('{}',...menuRequestBindings(scope,id)),
    ])
  } catch(error) {
    if(error instanceof Error && error.message.includes('UNIQUE constraint failed: menu_operation_requests.')) {
      const winner=await lookup(db,scope,id,json)
      if(winner)return winner
    }
    throw error
  }
  const result=await lookup(db,scope,id,json)
  if(!result)throw new Error('Missing menu operation result')
  return result
}
export function menuGuard(db:D1Database,scope:MenuScope,id:string,condition:string,bindings:(string|number|null)[]):D1PreparedStatement {
  return db.prepare('UPDATE menu_operation_requests SET guard=CASE WHEN ('+condition+') THEN 1 ELSE 0 END WHERE '+menuRequestKey).bind(...bindings,...menuRequestBindings(scope,id))
}
export function finalizeMenuOperation(db:D1Database,scope:MenuScope,id:string,status:200|201,responseSql:string,bindings:(string|number|null)[]):D1PreparedStatement {
  return db.prepare('UPDATE menu_operation_requests SET response_status=?,response_json=('+responseSql+') WHERE '+menuRequestKey).bind(status,...bindings,...menuRequestBindings(scope,id))
}
export function isMenuConflict(error:unknown):boolean {
  return error instanceof Error && ['menu_link_revision','menu_operation_guard','menu_link_daily_conflict','menu_link_zero_carry','menu_link_invalid_reference','inventory_menu_active_recipe_unique','UNIQUE constraint failed: inventory_menu_links.','UNIQUE constraint failed: menu_entries.inventory_menu_link_id'].some(name=>error.message.includes(name))
}
