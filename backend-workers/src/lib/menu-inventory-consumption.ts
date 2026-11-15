import { z } from 'zod'
import { currentWeekStart,getJstToday } from './date'
import { errorResponse } from './errors'
import { inventoryShoppingSync } from './inventory-shopping-sync'
import { executeMenuOperation,finalizeMenuOperation,isMenuConflict,menuConflict,menuGuard,menuNotFound,savedMenuOperation,type MenuScope,type MenuResult } from './menu-operation-requests'

export const menuMealInputSchema=z.object({requestId:z.string().uuid().transform(v=>v.toLowerCase()),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict()
type Input=z.infer<typeof menuMealInputSchema>
type Entry={id:number;week_start_date:string;inventory_menu_link_id:number|null;inventory_item_id:number|null}
async function perform(db:D1Database,scope:MenuScope,entryId:number,input:Input,undo:boolean):Promise<MenuResult>{
 const parsed=menuMealInputSchema.safeParse(input)
 if(!parsed.success||!Number.isSafeInteger(entryId)||entryId<1)return {status:400,body:errorResponse('VALIDATION_ERROR','入力内容を確認してください')}
 const value=parsed.data
 const json=JSON.stringify({version:1,operation:undo?'undo':'consume',entryId,expectedRevision:value.expectedRevision})
 const saved=await savedMenuOperation(db,scope,value.requestId,json)
 if(saved)return saved
 const entry=await db.prepare('SELECT e.id,e.week_start_date,e.inventory_menu_link_id,l.inventory_item_id FROM menu_entries e LEFT JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id WHERE e.id=? AND e.household_id=?').bind(entryId,scope.householdId).first<Entry>()
 if(!entry)return await savedMenuOperation(db,scope,value.requestId,json)??menuNotFound()
 const week=currentWeekStart(getJstToday())
 if(entry.week_start_date!==week||entry.inventory_menu_link_id===null||entry.inventory_item_id===null)return await savedMenuOperation(db,scope,value.requestId,json)??menuConflict()
 const e='e.id='+entryId+' AND e.household_id='+scope.householdId
 const from=' FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id JOIN inventory_items i ON i.id=l.inventory_item_id AND i.household_id=e.household_id '
 const common=e+" AND e.week_start_date='"+week+"' AND e.meal_revision="+value.expectedRevision+' AND e.meal_revision<9007199254740991'
 const eventId=crypto.randomUUID()
 const eligible=undo
  ? from+' JOIN menu_consumption_events v ON v.id=e.consumed_event_id AND v.menu_entry_id=e.id AND v.household_id=e.household_id AND v.inventory_item_id=i.id WHERE '+common+" AND e.meal_state='eaten' AND v.undone_at IS NULL AND i.quantity_tenths+v.quantity_tenths<=999999"
  : from+' JOIN recipes r ON r.id=l.recipe_id AND r.household_id=e.household_id WHERE '+common+" AND e.meal_state='uneaten' AND l.household_id=e.household_id AND l.enabled=1 AND i.auto_consumption_enabled=0 AND e.usage_tenths>0 AND i.quantity_tenths>=e.usage_tenths"
 try{
  return await executeMenuOperation(db,scope,value.requestId,json,()=>[
   menuGuard(db,scope,value.requestId,'EXISTS(SELECT 1'+eligible+')',[]),
   db.prepare('UPDATE inventory_items SET quantity_tenths=quantity_tenths'+(undo?'+':'-')+'(SELECT '+(undo?'v.quantity_tenths':'e.usage_tenths')+eligible+') WHERE id=(SELECT i.id'+eligible+')'),
   // inventoryShoppingSync must follow this UPDATE before any other write changes SQLite changes().
   ...inventoryShoppingSync(db,entry.inventory_item_id,scope.householdId),
   ...(undo?[
    db.prepare('UPDATE menu_consumption_events SET undone_at=? WHERE id=(SELECT consumed_event_id FROM menu_entries WHERE id=?)').bind(new Date().toISOString(),entryId),
    db.prepare("UPDATE menu_entries SET meal_state='uneaten',consumed_event_id=NULL,meal_revision=meal_revision+1 WHERE id=?").bind(entryId),
   ]:[
    db.prepare('INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths) SELECT ?,e.household_id,e.id,l.inventory_item_id,e.usage_tenths FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id WHERE e.id=?').bind(eventId,entryId),
    db.prepare("UPDATE menu_entries SET meal_state='eaten',consumed_event_id=?,meal_revision=meal_revision+1 WHERE id=?").bind(eventId,entryId),
   ]),
   finalizeMenuOperation(db,scope,value.requestId,200,"SELECT json_object('menuEntryId',e.id,'mealState',e.meal_state,'mealRevision',e.meal_revision,'inventoryItemId',i.id,'quantity',i.quantity_tenths/10.0,'carryEnabled',json(CASE l.carry_enabled WHEN 1 THEN 'true' ELSE 'false' END))"+from+' WHERE '+e,[]),
  ])
 }catch(error){if(isMenuConflict(error))return menuConflict();throw error}
}
export function consumeMenuEntry(db:D1Database,scope:MenuScope,entryId:number,input:Input){return perform(db,scope,entryId,input,false)}
export function undoMenuConsumption(db:D1Database,scope:MenuScope,entryId:number,input:Input){return perform(db,scope,entryId,input,true)}





type MenuLinkageRow={
 entry_id:number;week_start_date:string;usage_tenths:number;meal_state:string;meal_revision:number;id:number;
 inventory_item_id:number|null;recipe_id:number|null;enabled:number;carry_enabled:number;revision:number;
 inventory_name:string|null;quantity_tenths:number|null;auto_consumption_enabled:number|null;
 event_id:string|null;event_quantity_tenths:number|null;undone_at:string|null
}
const menuLinkageQuery='SELECT e.id AS entry_id,e.week_start_date,e.usage_tenths,e.meal_state,e.meal_revision,l.id,l.inventory_item_id,l.recipe_id,l.enabled,l.carry_enabled,l.revision,i.name AS inventory_name,i.quantity_tenths,i.auto_consumption_enabled,v.id AS event_id,v.quantity_tenths AS event_quantity_tenths,v.undone_at FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id AND l.household_id=e.household_id LEFT JOIN inventory_items i ON i.id=l.inventory_item_id AND i.household_id=e.household_id LEFT JOIN menu_consumption_events v ON v.id=e.consumed_event_id AND v.menu_entry_id=e.id AND v.inventory_item_id=i.id AND v.household_id=e.household_id WHERE '
function menuLinkageResponse(row:MenuLinkageRow){
 const current=row.week_start_date===currentWeekStart(getJstToday())
 const unavailableReason=row.inventory_item_id===null?'inventory_deleted':row.recipe_id===null?'recipe_deleted':!row.enabled?'link_disabled':row.auto_consumption_enabled?'daily_consumption':null
 return {linkId:row.id,inventoryItemId:row.inventory_item_id,inventoryName:row.inventory_name,quantity:row.quantity_tenths===null?null:row.quantity_tenths/10,usageQuantity:row.usage_tenths/10,enabled:!!row.enabled,carryEnabled:!!row.carry_enabled,linkRevision:row.revision,mealState:row.meal_state,mealRevision:row.meal_revision,
 canConsume:current&&unavailableReason===null&&row.meal_state==='uneaten'&&(row.quantity_tenths??0)>=row.usage_tenths,
 canUndo:current&&row.meal_state==='eaten'&&row.inventory_item_id!==null&&row.event_id!==null&&row.undone_at===null&&row.quantity_tenths!==null&&row.event_quantity_tenths!==null&&row.quantity_tenths+row.event_quantity_tenths<=999999,
 unavailableReason}
}
export async function menuInventoryLinkage(db:D1Database,householdId:number,entryId:number){
 const row=await db.prepare(menuLinkageQuery+'e.id=? AND e.household_id=?').bind(entryId,householdId).first<MenuLinkageRow>()
 return row?menuLinkageResponse(row):null
}
/** Fetch only this household's selected week; ordinary entries map to null at the route. */
export async function menuInventoryLinkagesForWeek(db:D1Database,householdId:number,weekStartDate:string){
 const rows=await db.prepare(menuLinkageQuery+'e.household_id=? AND e.week_start_date=? ORDER BY e.id').bind(householdId,weekStartDate).all<MenuLinkageRow>()
 return new Map(rows.results.map(row=>[row.entry_id,menuLinkageResponse(row)]))
}
