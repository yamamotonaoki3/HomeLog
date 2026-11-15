import { z } from 'zod'
import { currentWeekStart,getJstToday } from './date'
import { fromTenths,isOneDecimalPlace,MAX_VALUE,toTenths } from './decimal'
import { errorResponse } from './errors'
import { consumptionDate } from './inventory-consumption'
import { inventoryShoppingSync } from './inventory-shopping-sync'
import { executeMenuOperation,finalizeMenuOperation,isMenuConflict,menuConflict,menuGuard,savedMenuOperation,type MenuLink,type MenuResult } from './menu-operation-requests'

const usage=z.number().min(0.1).max(MAX_VALUE).refine(isOneDecimalPlace)
const menu=z.object({newRecipeTitle:z.string().trim().min(1).max(100).optional(),recipeId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),usageQuantity:usage.default(1),carryEnabled:z.boolean().default(false)}).refine(v=>(v.newRecipeTitle!==undefined)!==(v.recipeId!==undefined))
export const menuLinkageSchema=z.object({requestId:z.string().uuid().transform(v=>v.toLowerCase()),menus:z.array(menu).min(1).max(20)}).refine(v=>new Set(v.menus.filter(m=>m.recipeId!==undefined).map(m=>m.recipeId)).size===v.menus.filter(m=>m.recipeId!==undefined).length)
export type LinkedInventoryInput={name:string;normalizedName:string;categoryId:number;storeId:number|null;quantity:number;threshold:number;price?:number|null;dailyConsumption?:number|null;autoConsumptionEnabled?:boolean;menuLinkage:z.infer<typeof menuLinkageSchema>}
export const menuLinkUpdateSchema=z.object({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),usageQuantity:usage,enabled:z.boolean(),carryEnabled:z.boolean()}).refine(v=>v.enabled||!v.carryEnabled)
type LinkRow={id:number;recipe_id:number|null;recipe_title:string;usage_tenths:number;enabled:number;carry_enabled:number;revision:number}
export async function inventoryMenuLinksFor(db:D1Database,householdId:number,itemId:number):Promise<MenuLink[]>{
 const rows=await db.prepare('SELECT l.id,l.recipe_id,COALESCE(r.title,l.recipe_title_snapshot) AS recipe_title,l.usage_tenths,l.enabled,l.carry_enabled,l.revision FROM inventory_menu_links l LEFT JOIN recipes r ON r.id=l.recipe_id AND r.household_id=l.household_id WHERE l.household_id=? AND l.inventory_item_id=? ORDER BY l.id').bind(householdId,itemId).all<LinkRow>()
 return rows.results.map(menuLinkResponse)
}
export async function createLinkedInventory(db:D1Database,actorId:number,householdId:number,input:LinkedInventoryInput):Promise<MenuResult>{
 const scope={actorUserId:actorId,householdId},id=input.menuLinkage.requestId
 const json=JSON.stringify({version:1,operation:'create-inventory',...input})
 const saved=await savedMenuOperation(db,scope,id,json)
 if(saved)return saved
 const invalid=async()=>await savedMenuOperation(db,scope,id,json)??({status:400,body:errorResponse('VALIDATION_ERROR','献立連携の入力内容を確認してください')})
 if(input.autoConsumptionEnabled??input.dailyConsumption!=null)return invalid()
 if(input.quantity===0&&input.menuLinkage.menus.some(m=>m.carryEnabled))return invalid()
 const existing=await db.prepare('SELECT name FROM inventory_items WHERE household_id=?').bind(householdId).all<{name:string}>()
 const normalized=(name:string)=>name.normalize('NFKC').toLowerCase().trim().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))
 if(existing.results.some(row=>normalized(row.name)===input.normalizedName)){
  const raced=await savedMenuOperation(db,scope,id,json)
  return raced??{status:409,body:errorResponse('DUPLICATE_INVENTORY_ITEM_NAME','同じ品名の在庫が既に登録されています')}
 }
 if(!await db.prepare('SELECT id FROM zaiko_categories WHERE id=? AND household_id=?').bind(input.categoryId,householdId).first())return invalid()
 if(input.storeId!==null&&!await db.prepare('SELECT id FROM stores WHERE id=? AND household_id=?').bind(input.storeId,householdId).first())return invalid()
 for(const line of input.menuLinkage.menus)if(line.recipeId!==undefined&&!await db.prepare('SELECT id FROM recipes WHERE id=? AND household_id=?').bind(line.recipeId,householdId).first())return invalid()
 const week=currentWeekStart(getJstToday())
 const stock='(SELECT id FROM inventory_items WHERE household_id='+householdId+' AND normalized_name=?)'
 try{return await executeMenuOperation(db,scope,id,json,()=>{
  const statements:D1PreparedStatement[]=[
   menuGuard(db,scope,id,'NOT EXISTS(SELECT 1 FROM inventory_items WHERE household_id=? AND normalized_name=?) AND EXISTS(SELECT 1 FROM zaiko_categories WHERE id=? AND household_id=?)'+(input.storeId===null?'':' AND EXISTS(SELECT 1 FROM stores WHERE id=? AND household_id=?)'),[householdId,input.normalizedName,input.categoryId,householdId,...(input.storeId===null?[]:[input.storeId,householdId])]),
   db.prepare('INSERT INTO inventory_items(household_id,name,normalized_name,category_id,store_id,price,quantity_tenths,threshold_tenths,daily_consumption_tenths,auto_consumption_enabled,last_consumed_on) VALUES(?,?,?,?,?,?,?,?,?,0,?)').bind(householdId,input.name.trim(),input.normalizedName,input.categoryId,input.storeId,input.price??null,toTenths(input.quantity),toTenths(input.threshold),input.dailyConsumption==null?null:toTenths(input.dailyConsumption),consumptionDate()),
   ...inventoryShoppingSync(db,null,householdId),
  ]
  for(const line of input.menuLinkage.menus){
   if(line.newRecipeTitle!==undefined)statements.push(db.prepare("INSERT INTO recipes(household_id,created_by_user_id,title,source_type) VALUES(?,?,?,'manual')").bind(householdId,actorId,line.newRecipeTitle))
   statements.push(db.prepare('INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,usage_tenths,carry_enabled,starts_on) SELECT ?, '+stock+',r.id,r.title,?,?,? FROM recipes r WHERE r.id='+(line.recipeId===undefined?'last_insert_rowid()':'?')+' AND r.household_id=?').bind(householdId,input.normalizedName,toTenths(line.usageQuantity),line.carryEnabled?1:0,week,...(line.recipeId===undefined?[]:[line.recipeId]),householdId))
   // A reference deleted since prevalidation must roll back the whole registration.
   statements.push(menuGuard(db,scope,id,'changes()=1',[]))
   // Updating the request does not change last_insert_rowid(), so this remains the link id.
   statements.push(db.prepare('INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) SELECT l.household_id,l.recipe_id,?,l.id,l.usage_tenths,r.title FROM inventory_menu_links l JOIN recipes r ON r.id=l.recipe_id AND r.household_id=l.household_id WHERE l.id=last_insert_rowid()').bind(week))
  }
  statements.push(finalizeMenuOperation(db,scope,id,201,"SELECT json_object('id',i.id,'name',i.name,'categoryId',i.category_id,'storeId',i.store_id,'quantity',i.quantity_tenths/10.0,'threshold',i.threshold_tenths/10.0,'price',i.price,'dailyConsumption',i.daily_consumption_tenths/10.0,'autoConsumptionEnabled',json('false'),'linkedMenuEntries',json((SELECT json_group_array(json_object('id',e.id,'recipeId',e.recipe_id,'recipeTitle',e.recipe_title_snapshot,'weekStartDate',e.week_start_date,'usageQuantity',e.usage_tenths/10.0)) FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id WHERE l.inventory_item_id=i.id))) FROM inventory_items i WHERE i.id="+stock,[input.normalizedName]))
  return statements
 })}catch(error){if(isMenuConflict(error))return menuConflict();throw error}
}
export async function updateMenuLink(db:D1Database,householdId:number,linkId:number,input:z.infer<typeof menuLinkUpdateSchema>):Promise<MenuResult>{
 const current=await db.prepare('SELECT inventory_item_id,recipe_id,enabled,carry_enabled,remaining_count FROM inventory_menu_links WHERE id=? AND household_id=?').bind(linkId,householdId).first<{inventory_item_id:number|null;recipe_id:number|null;enabled:number;carry_enabled:number;remaining_count:number|null}>()
 if(!current)return {status:404,body:errorResponse('RESOURCE_NOT_FOUND','献立連携が見つかりません')}
 if(current.remaining_count!==null)return menuConflict()
 const activate=(!current.enabled&&input.enabled)||(!current.carry_enabled&&input.carryEnabled)
 const week=currentWeekStart(getJstToday())
 try{
  const results=await db.batch([
   // Reject reactivation inside the write: the revision CHECK rolls back the entire batch.
   db.prepare('UPDATE inventory_menu_links SET usage_tenths=?,enabled=?,carry_enabled=?,revision=CASE WHEN remaining_count IS NULL AND revision=? AND revision<9007199254740991 AND (NOT ((enabled=0 AND ?=1) OR (carry_enabled=0 AND ?=1)) OR EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=inventory_menu_links.inventory_item_id AND i.household_id=inventory_menu_links.household_id AND i.quantity_tenths>0)) THEN revision+1 ELSE -1 END WHERE id=? AND household_id=? RETURNING id').bind(toTenths(input.usageQuantity),input.enabled?1:0,input.carryEnabled?1:0,input.expectedRevision,input.enabled?1:0,input.carryEnabled?1:0,linkId,householdId),
   db.prepare("UPDATE menu_entries SET usage_tenths=?,meal_revision=meal_revision+1 WHERE inventory_menu_link_id=? AND week_start_date=? AND meal_state='uneaten' AND EXISTS(SELECT 1 FROM inventory_menu_links WHERE id=? AND revision=? AND changes()>0)").bind(toTenths(input.usageQuantity),linkId,week,linkId,input.expectedRevision+1),
   db.prepare('INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) SELECT l.household_id,l.recipe_id,?,l.id,l.usage_tenths,r.title FROM inventory_menu_links l JOIN recipes r ON r.id=l.recipe_id AND r.household_id=l.household_id WHERE l.id=? AND l.household_id=? AND l.revision=? AND l.enabled=1 AND ?=1 ON CONFLICT(inventory_menu_link_id,week_start_date) DO NOTHING').bind(week,linkId,householdId,input.expectedRevision+1,activate?1:0),
   db.prepare('SELECT l.id,l.recipe_id,COALESCE(r.title,l.recipe_title_snapshot) AS recipe_title,l.usage_tenths,l.enabled,l.carry_enabled,l.revision FROM inventory_menu_links l LEFT JOIN recipes r ON r.id=l.recipe_id AND r.household_id=l.household_id WHERE l.id=? AND l.household_id=?').bind(linkId,householdId),
  ])
  if(results[0].results.length===0)return menuConflict()
  const row=results[3].results[0] as LinkRow
  return {status:200,body:{id:row.id,recipeId:row.recipe_id,recipeTitle:row.recipe_title,usageQuantity:fromTenths(row.usage_tenths),enabled:!!row.enabled,carryEnabled:!!row.carry_enabled,revision:row.revision}}
 }catch(error){if(isMenuConflict(error))return menuConflict();throw error}
}

function menuLinkResponse(row:LinkRow):MenuLink {
 return {id:row.id,recipeId:row.recipe_id,recipeTitle:row.recipe_title,usageQuantity:fromTenths(row.usage_tenths),enabled:!!row.enabled,carryEnabled:!!row.carry_enabled,revision:row.revision}
}
/** One scoped read for the inventory list, including ordinary inventories without links. */
export async function inventoryMenuLinksByInventory(db:D1Database,householdId:number):Promise<Map<number,MenuLink[]>> {
 const rows=await db.prepare('SELECT l.inventory_item_id,l.id,l.recipe_id,COALESCE(r.title,l.recipe_title_snapshot) AS recipe_title,l.usage_tenths,l.enabled,l.carry_enabled,l.revision FROM inventory_menu_links l LEFT JOIN recipes r ON r.id=l.recipe_id AND r.household_id=l.household_id WHERE l.household_id=? AND l.inventory_item_id IS NOT NULL ORDER BY l.id').bind(householdId).all<LinkRow&{inventory_item_id:number}>()
 const grouped=new Map<number,MenuLink[]>()
 for(const row of rows.results){
  const links=grouped.get(row.inventory_item_id)??[]
  links.push(menuLinkResponse(row))
  grouped.set(row.inventory_item_id,links)
 }
 return grouped
}
