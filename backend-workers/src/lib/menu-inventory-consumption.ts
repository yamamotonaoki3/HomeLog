import { z } from 'zod'
import { currentWeekStart,getJstToday } from './date'
import { errorResponse } from './errors'
import { inventoryShoppingSync } from './inventory-shopping-sync'
import { executeMenuOperation,finalizeMenuOperation,isMenuConflict,menuConflict,menuGuard,menuNotFound,savedMenuOperation,type MenuScope,type MenuResult } from './menu-operation-requests'

export const menuMealInputSchema=z.object({requestId:z.string().uuid().transform(v=>v.toLowerCase()),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict()
type Input=z.infer<typeof menuMealInputSchema>
type Entry={id:number;week_start_date:string;inventory_menu_link_id:number|null;inventory_item_id:number|null;consumed_event_id:string|null}
async function perform(db:D1Database,scope:MenuScope,entryId:number,input:Input,undo:boolean):Promise<MenuResult>{
 const parsed=menuMealInputSchema.safeParse(input)
 if(!parsed.success||!Number.isSafeInteger(entryId)||entryId<1)return {status:400,body:errorResponse('VALIDATION_ERROR','入力内容を確認してください')}
 const value=parsed.data
 const json=JSON.stringify({version:1,operation:undo?'undo':'consume',entryId,expectedRevision:value.expectedRevision})
 const saved=await savedMenuOperation(db,scope,value.requestId,json)
 if(saved)return saved
 const entry=await db.prepare('SELECT e.id,e.week_start_date,e.inventory_menu_link_id,e.consumed_event_id,'+(undo?'v':'l')+'.inventory_item_id FROM menu_entries e LEFT JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id AND l.household_id=e.household_id LEFT JOIN menu_consumption_events v ON v.id=e.consumed_event_id AND v.menu_entry_id=e.id AND v.household_id=e.household_id WHERE e.id=? AND e.household_id=?').bind(entryId,scope.householdId).first<Entry>()
 if(!entry)return await savedMenuOperation(db,scope,value.requestId,json)??menuNotFound()
 const week=currentWeekStart(getJstToday())
 if(entry.week_start_date!==week||entry.inventory_item_id===null||(!undo&&entry.inventory_menu_link_id===null))return await savedMenuOperation(db,scope,value.requestId,json)??menuConflict()
 const e='e.id='+entryId+' AND e.household_id='+scope.householdId
 const from=' FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id JOIN inventory_items i ON i.id=l.inventory_item_id AND i.household_id=e.household_id '
 const common=e+" AND e.week_start_date='"+week+"' AND e.meal_revision="+value.expectedRevision+' AND e.meal_revision<9007199254740991 AND i.id='+entry.inventory_item_id
 const topGuard='e.consumed_event_id IS ?'
 const eventId=crypto.randomUUID()
 const eligible=undo
  ? ' FROM menu_entries e JOIN menu_consumption_events v ON v.id=e.consumed_event_id AND v.menu_entry_id=e.id AND v.household_id=e.household_id JOIN inventory_items i ON i.id=v.inventory_item_id AND i.household_id=e.household_id WHERE '+common+' AND '+topGuard+' AND v.undone_at IS NULL AND i.quantity_tenths+v.quantity_tenths<=999999'
  : from+' JOIN recipes r ON r.id=l.recipe_id AND r.household_id=e.household_id WHERE '+common+' AND '+topGuard+" AND l.household_id=e.household_id AND i.auto_consumption_enabled=0 AND ((l.remaining_count IS NOT NULL AND i.menu_plan_enabled=1 AND l.remaining_count>0 AND i.quantity_tenths>=10) OR (l.remaining_count IS NULL AND e.meal_state='uneaten' AND l.enabled=1 AND e.usage_tenths>0 AND i.quantity_tenths>=e.usage_tenths))"
 const target=' FROM menu_entries e JOIN menu_consumption_events v ON v.id=e.consumed_event_id WHERE '+e
 try{
  return await executeMenuOperation(db,scope,value.requestId,json,()=>[
   // Validate the original top/revision/count once. Subsequent writes use that guarded
   // source without checking a count that this very transaction has already changed.
   menuGuard(db,scope,value.requestId,'EXISTS(SELECT 1'+eligible+')',[entry.consumed_event_id]),
   ...(!undo?[
    db.prepare('UPDATE inventory_menu_links SET remaining_count=remaining_count-1 WHERE id=(SELECT inventory_menu_link_id FROM menu_entries WHERE id=?) AND remaining_count IS NOT NULL').bind(entryId),
   ]:[]),
   db.prepare('UPDATE inventory_items SET quantity_tenths=quantity_tenths'+(undo?'+':'-')+'(SELECT '+(undo?'v.quantity_tenths'+target:'CASE WHEN l.remaining_count IS NULL THEN e.usage_tenths ELSE 10 END'+from+' WHERE '+e)+') WHERE id=?').bind(entry.inventory_item_id),
   // inventoryShoppingSync must follow this UPDATE before any other write changes SQLite changes().
   ...inventoryShoppingSync(db,entry.inventory_item_id,scope.householdId),
   ...(undo?[
    // Only the still-attached original planned link receives its count back.
    // Event delta NULL remains stock-only even after a legacy link is converted.
    db.prepare('UPDATE inventory_menu_links SET remaining_count=remaining_count+1 WHERE id=(SELECT v.inventory_menu_link_id'+target+' AND v.plan_count_delta=1) AND household_id=? AND inventory_item_id=? AND remaining_count IS NOT NULL').bind(scope.householdId,entry.inventory_item_id),
    db.prepare('UPDATE menu_consumption_events SET undone_at=? WHERE id=(SELECT consumed_event_id FROM menu_entries WHERE id=?)').bind(new Date().toISOString(),entryId),
    db.prepare("UPDATE menu_entries SET meal_state=CASE WHEN (SELECT previous_event_id FROM menu_consumption_events WHERE id=consumed_event_id) IS NULL THEN 'uneaten' ELSE 'eaten' END,consumed_event_id=(SELECT previous_event_id FROM menu_consumption_events WHERE id=consumed_event_id),meal_revision=meal_revision+1 WHERE id=?").bind(entryId),
   ]:[
    db.prepare('INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths,plan_count_delta,inventory_menu_link_id,previous_event_id) SELECT ?,e.household_id,e.id,l.inventory_item_id,CASE WHEN l.remaining_count IS NULL THEN e.usage_tenths ELSE 10 END,CASE WHEN l.remaining_count IS NULL THEN NULL ELSE 1 END,l.id,e.consumed_event_id FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id WHERE e.id=?').bind(eventId,entryId),
    db.prepare("UPDATE menu_entries SET meal_state='eaten',consumed_event_id=?,meal_revision=meal_revision+1 WHERE id=?").bind(eventId,entryId),
   ]),
   finalizeMenuOperation(db,scope,value.requestId,200,"SELECT json_object('menuEntryId',e.id,'mealState',e.meal_state,'mealRevision',e.meal_revision,'inventoryItemId',i.id,'quantity',i.quantity_tenths/10.0,'carryEnabled',json(CASE l.carry_enabled WHEN 1 THEN 'true' ELSE 'false' END),'remainingCount',l.remaining_count,'menuPlanEnabled',json(CASE i.menu_plan_enabled WHEN 1 THEN 'true' ELSE 'false' END),'menuPlanRevision',i.menu_plan_revision) FROM menu_entries e JOIN inventory_items i ON i.id="+entry.inventory_item_id+' AND i.household_id=e.household_id LEFT JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id AND l.household_id=e.household_id WHERE '+e,[]),
  ])
 }catch(error){if(isMenuConflict(error))return menuConflict();throw error}
}
export function consumeMenuEntry(db:D1Database,scope:MenuScope,entryId:number,input:Input){return perform(db,scope,entryId,input,false)}
export function undoMenuConsumption(db:D1Database,scope:MenuScope,entryId:number,input:Input){return perform(db,scope,entryId,input,true)}





type MenuLinkageRow={
 entry_id:number;week_start_date:string;usage_tenths:number|null;meal_state:'uneaten'|'eaten';meal_revision:number;id:number|null;
 inventory_item_id:number|null;recipe_id:number|null;enabled:number|null;carry_enabled:number|null;revision:number|null;
 inventory_name:string|null;quantity_tenths:number|null;auto_consumption_enabled:number|null;
 remaining_count:number|null;memo:string|null;menu_plan_enabled:number|null;menu_plan_revision:number|null;
 reserved_tenths:number;event_id:string|null;event_quantity_tenths:number|null;undone_at:string|null;
 undo_inventory_item_id:number|null;undo_inventory_name:string|null;undo_quantity_tenths:number|null;
 undo_daily_enabled:number|null;restore_count:number|null
}
export type MenuInventoryLinkage={
 linkId:number|null;inventoryItemId:number|null;inventoryName:string|null;quantity:number|null;usageQuantity:number|null;
 enabled:boolean;carryEnabled:boolean;linkRevision:number|null;mealState:'uneaten'|'eaten';mealRevision:number;
 remainingCount:number|null;memo:string|null;menuPlanEnabled:boolean|null;menuPlanRevision:number|null;
 canConsume:boolean;canUndo:boolean;undoQuantity:number|null;
 unavailableReason:'inventory_deleted'|'recipe_deleted'|'link_disabled'|'daily_consumption'|null
}
// The top event owns refunds, including rows whose original link has been removed.
// All relations remain in this one household/week-scoped read (no row-by-row lookups).
const menuLinkageQuery=`SELECT e.id AS entry_id,e.week_start_date,e.usage_tenths,e.meal_state,e.meal_revision,
 l.id,i.id AS inventory_item_id,r.id AS recipe_id,l.enabled,l.carry_enabled,l.revision,
 l.remaining_count,l.memo,i.name AS inventory_name,i.quantity_tenths,i.auto_consumption_enabled,i.menu_plan_enabled,i.menu_plan_revision,
 COALESCE(a.reserved_tenths,0) AS reserved_tenths,v.id AS event_id,v.quantity_tenths AS event_quantity_tenths,v.undone_at,
 u.id AS undo_inventory_item_id,u.name AS undo_inventory_name,u.quantity_tenths AS undo_quantity_tenths,u.auto_consumption_enabled AS undo_daily_enabled,
 CASE WHEN v.plan_count_delta=1 AND original.remaining_count IS NOT NULL THEN 1 ELSE 0 END AS restore_count
 FROM menu_entries e
 LEFT JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id AND l.household_id=e.household_id
 LEFT JOIN recipes r ON r.id=l.recipe_id AND r.household_id=e.household_id
 LEFT JOIN inventory_items i ON i.id=l.inventory_item_id AND i.household_id=e.household_id
 LEFT JOIN (SELECT household_id,inventory_item_id,SUM(remaining_count)*10 AS reserved_tenths FROM inventory_menu_links WHERE household_id=?1 GROUP BY household_id,inventory_item_id) a ON a.inventory_item_id=i.id AND a.household_id=e.household_id
 LEFT JOIN menu_consumption_events v ON v.id=e.consumed_event_id AND v.menu_entry_id=e.id AND v.household_id=e.household_id
 LEFT JOIN inventory_items u ON u.id=v.inventory_item_id AND u.household_id=e.household_id
 LEFT JOIN inventory_menu_links original ON original.id=v.inventory_menu_link_id AND original.household_id=e.household_id AND original.inventory_item_id=u.id
 WHERE (e.inventory_menu_link_id IS NOT NULL OR e.usage_tenths IS NOT NULL OR e.recipe_title_snapshot IS NOT NULL OR e.consumed_event_id IS NOT NULL) AND `
function menuLinkageResponse(row:MenuLinkageRow):MenuInventoryLinkage{
 const current=row.week_start_date===currentWeekStart(getJstToday())
 const planned=row.remaining_count!==null
 const detached=row.id===null
 const inventoryId=detached?row.undo_inventory_item_id:row.inventory_item_id
 const quantity=detached?row.undo_quantity_tenths:row.quantity_tenths
 const unavailableReason=inventoryId===null?'inventory_deleted':detached?'link_disabled':row.recipe_id===null?'recipe_deleted':(planned?!row.menu_plan_enabled:!row.enabled)?'link_disabled':row.auto_consumption_enabled?'daily_consumption':null
 const canUndo=current&&row.event_id!==null&&row.undone_at===null&&row.undo_inventory_item_id!==null&&row.undo_quantity_tenths!==null&&row.event_quantity_tenths!==null&&row.undo_quantity_tenths+row.event_quantity_tenths<=999999&&!(row.restore_count===1&&row.undo_daily_enabled===1)
 return {linkId:row.id,inventoryItemId:inventoryId,inventoryName:detached?row.undo_inventory_name:row.inventory_name,quantity:quantity===null?null:quantity/10,usageQuantity:row.usage_tenths===null?null:row.usage_tenths/10,enabled:!!row.enabled,carryEnabled:!!row.carry_enabled,linkRevision:row.revision,mealState:row.meal_state,mealRevision:row.meal_revision,
 remainingCount:current&&!detached?row.remaining_count:null,memo:current&&!detached?row.memo:null,menuPlanEnabled:detached||row.menu_plan_enabled===null?null:!!row.menu_plan_enabled,menuPlanRevision:detached?null:row.menu_plan_revision,
 canConsume:current&&unavailableReason===null&&(planned?(row.remaining_count??0)>0&&(row.quantity_tenths??0)>=10:row.meal_state==='uneaten'&&row.usage_tenths!==null&&(row.quantity_tenths??0)-row.usage_tenths>=row.reserved_tenths),
 canUndo,undoQuantity:canUndo?row.event_quantity_tenths!/10:null,
 unavailableReason}
}
export async function menuInventoryLinkage(db:D1Database,householdId:number,entryId:number){
 const row=await db.prepare(menuLinkageQuery+'e.id=?2 AND e.household_id=?1').bind(householdId,entryId).first<MenuLinkageRow>()
 return row?menuLinkageResponse(row):null
}
/** Fetch only this household's selected week; ordinary entries map to null at the route. */
export async function menuInventoryLinkagesForWeek(db:D1Database,householdId:number,weekStartDate:string){
 const rows=await db.prepare(menuLinkageQuery+'e.household_id=?1 AND e.week_start_date=?2 ORDER BY e.id').bind(householdId,weekStartDate).all<MenuLinkageRow>()
 return new Map(rows.results.map(row=>[row.entry_id,menuLinkageResponse(row)]))
}
