import { z } from 'zod'
import { currentWeekStart, getJstToday } from './date'
import { toTenths } from './decimal'
import { errorResponse } from './errors'
import { consumptionDate, consumptionDays, latestConsumptionDate } from './inventory-consumption'
import { inventoryShoppingSync } from './inventory-shopping-sync'
import { executeMenuOperation, finalizeMenuOperation, isMenuConflict, menuConflict, menuGuard, menuNotFound, savedMenuOperation, type MenuLink, type MenuResult } from './menu-operation-requests'

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const common = { remainingCount: z.number().int().min(0).max(99999), memo: z.string().max(255).nullable(), carryEnabled: z.boolean() }
const planLine = z.union([
  z.object({ linkId: safeId, ...common }).strict(),
  z.object({ recipeId: safeId, ...common }).strict(),
  z.object({ newRecipeTitle: z.string().trim().min(1).max(100), ...common }).strict(),
])
export const menuPlanSchema = z.object({ requestId: z.string().uuid().transform(value => value.toLowerCase()), enabled: z.boolean(), links: z.array(planLine).max(20) }).strict().refine(plan => {
  const links = plan.links.flatMap(line => 'linkId' in line ? [line.linkId] : [])
  const recipes = plan.links.flatMap(line => 'recipeId' in line ? [line.recipeId] : [])
  return new Set(links).size === links.length && new Set(recipes).size === recipes.length
})
export type MenuPlan = z.infer<typeof menuPlanSchema>
export type InventoryMenuPlanInput = { name:string; normalizedName:string; categoryId:number; storeId:number|null; quantity:number; threshold:number; price?:number|null; dailyConsumption?:number|null; autoConsumptionEnabled?:boolean; expectedMenuPlanRevision?:number; menuPlan:MenuPlan }
export type InventoryMenuPlanResponse = { id:number; name:string; categoryId:number; storeId:number|null; quantity:number; threshold:number; price:number|null; dailyConsumption:number|null; autoConsumptionEnabled:boolean; menuPlanEnabled:boolean; menuPlanRevision:number; menuLinks:(MenuLink & {remainingCount:number;memo:string|null})[]; linkedMenuEntries:{id:number;recipeId:number|null;recipeTitle:string;weekStartDate:string;usageQuantity:number}[] }
type Item = { id:number; quantity_tenths:number; daily_consumption_tenths:number|null; auto_consumption_enabled:number; last_consumed_on:string|null; consumption_revision:number; menu_plan_revision:number; price:number|null }
type Link = { id:number; recipe_id:number|null; revision:number }
const invalid = (message='献立予定の入力内容を確認してください'):MenuResult => ({ status:400, body:errorResponse('VALIDATION_ERROR',message) })
const duplicate = ():MenuResult => ({status:409,body:errorResponse('DUPLICATE_INVENTORY_ITEM_NAME','同じ品名の在庫が既に登録されています')})
const normalize = (name:string) => name.normalize('NFKC').toLowerCase().trim().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))

/** Auth/current household authorization must precede this entry point. Replays precede all entity guards. */
export async function saveInventoryMenuPlan(db:D1Database, actorUserId:number, householdId:number, input:InventoryMenuPlanInput, itemId?:number):Promise<MenuResult> {
  const scope={actorUserId,householdId}, requestId=input.menuPlan.requestId
  const json=JSON.stringify({version:2,operation:itemId===undefined?'create-inventory-plan':'replace-inventory-plan',itemId,
    name:input.name.trim(),normalizedName:input.normalizedName,categoryId:input.categoryId,storeId:input.storeId,quantity:input.quantity,
    threshold:input.threshold,price:input.price,dailyConsumption:input.dailyConsumption,autoConsumptionEnabled:input.autoConsumptionEnabled,
    expectedMenuPlanRevision:input.expectedMenuPlanRevision,menuPlan:input.menuPlan})
  const saved=await savedMenuOperation(db,scope,requestId,json)
  if(saved)return saved
  const fail=async(result:MenuResult)=>await savedMenuOperation(db,scope,requestId,json)??result
  const current=itemId===undefined?null:await db.prepare('SELECT * FROM inventory_items WHERE id=? AND household_id=?').bind(itemId,householdId).first<Item>()
  if(itemId!==undefined&&!current)return fail(menuNotFound())
  if(current&&current.menu_plan_revision!==input.expectedMenuPlanRevision)return fail(menuConflict())
  if(!await db.prepare('SELECT id FROM zaiko_categories WHERE id=? AND household_id=?').bind(input.categoryId,householdId).first())return fail(invalid('指定されたカテゴリーが見つかりません'))
  if(input.storeId!==null&&!await db.prepare('SELECT id FROM stores WHERE id=? AND household_id=?').bind(input.storeId,householdId).first())return fail(invalid('指定された店舗が見つかりません'))
  const names=await db.prepare('SELECT id,name FROM inventory_items WHERE household_id=?').bind(householdId).all<{id:number;name:string}>()
  if(names.results.some(row=>row.id!==itemId&&normalize(row.name)===input.normalizedName))return fail(duplicate())
  const existing=itemId===undefined?[]:(await db.prepare('SELECT id,recipe_id,revision FROM inventory_menu_links WHERE inventory_item_id=? AND household_id=?').bind(itemId,householdId).all<Link>()).results
  const recipeIds=input.menuPlan.links.flatMap(line=>'recipeId' in line?[line.recipeId]:[])
  const recipes=recipeIds.length?(await db.prepare('SELECT id FROM recipes WHERE household_id=? AND id IN ('+recipeIds.map(()=>'?').join(',')+')').bind(householdId,...recipeIds).all<{id:number}>()).results:[]
  const resolved:number[]=[]
  for(const line of input.menuPlan.links){
    if('linkId' in line){
      const link=existing.find(row=>row.id===line.linkId)
      if(!link)return fail(menuNotFound())
      if(link.recipe_id!==null)resolved.push(link.recipe_id)
    }else if('recipeId' in line){
      if(!recipes.some(row=>row.id===line.recipeId))return fail(menuNotFound())
      resolved.push(line.recipeId)
    }
  }
  if(new Set(resolved).size!==resolved.length)return fail(invalid())
  const allocated=input.menuPlan.links.reduce((sum,line)=>sum+line.remainingCount*10,0)
  const existingDailyAllocation=!!current?.auto_consumption_enabled&&allocated>0
  if(existingDailyAllocation&&input.autoConsumptionEnabled!==false)return fail(invalid('日次自動消費をOFFにしてから予定を割り当ててください'))
  const daily=input.dailyConsumption===undefined?(current?.daily_consumption_tenths??null):input.dailyConsumption===null?null:toTenths(input.dailyConsumption)
  const enabled=input.dailyConsumption===null?false:input.autoConsumptionEnabled??(current?!!current.auto_consumption_enabled:daily!==null)
  if((enabled&&daily===null)||(input.dailyConsumption===null&&input.autoConsumptionEnabled===true))return fail(invalid('自動消費には1日の消費量が必要です'))
  const changed=!!current&&(daily!==current.daily_consumption_tenths||enabled!==!!current.auto_consumption_enabled)
  const now=Date.now(), days=current?.auto_consumption_enabled&&current.last_consumed_on?consumptionDays(current.last_consumed_on,latestConsumptionDate(now)):0
  // Apply only the user's delta to settled stock, rather than restoring past daily consumption.
  const effectiveQuantity=current?Math.max(0,current.quantity_tenths-days*(current.daily_consumption_tenths??0))+toTenths(input.quantity)-current.quantity_tenths:toTenths(input.quantity)
  if(effectiveQuantity<0||effectiveQuantity>999999||allocated>effectiveQuantity)return fail(invalid('予定回数を減らしてから在庫数量を変更してください'))
  if(enabled&&allocated>0)return fail(invalid('日次自動消費をOFFにしてから予定を割り当ててください'))
  const baseline=current?(changed?[current.last_consumed_on??'',consumptionDate(now)].sort().at(-1)!:days>0?latestConsumptionDate(now):current.last_consumed_on):consumptionDate(now)
  const week=currentWeekStart(getJstToday())
  // Resolve by stable scoped key, never last_insert_rowid after shopping/recipe INSERTs.
  const target=itemId===undefined?'(SELECT id FROM inventory_items WHERE household_id='+householdId+' AND normalized_name='+sqlText(input.normalizedName)+')':String(itemId)
  const kept=input.menuPlan.links.flatMap(line=>'linkId' in line?[line.linkId]:[])
  const orderedLinks:string[]=[]
  const requestRow='household_id='+householdId+' AND actor_user_id='+actorUserId+' AND request_id='+sqlText(requestId)
  const capturedLink=(index:number)=>"(SELECT json_extract(response_json,'$.links["+index+"]') FROM menu_operation_requests WHERE "+requestRow+")"
  try {
    return await executeMenuOperation(db,scope,requestId,json,()=>{
      const statements:D1PreparedStatement[]=[menuGuard(db,scope,requestId,
        (current?'EXISTS(SELECT 1 FROM inventory_items WHERE id=? AND household_id=? AND menu_plan_revision=?) AND ':'')+
        'NOT EXISTS(SELECT 1 FROM inventory_items WHERE household_id=? AND normalized_name=?'+(current?' AND id<>?':'')+') AND EXISTS(SELECT 1 FROM zaiko_categories WHERE id=? AND household_id=?)'+(input.storeId===null?'':' AND EXISTS(SELECT 1 FROM stores WHERE id=? AND household_id=?)'),
        [...(current?[itemId!,householdId,input.expectedMenuPlanRevision!]:[]),householdId,input.normalizedName,...(current?[itemId!]:[]),input.categoryId,householdId,...(input.storeId===null?[]:[input.storeId,householdId])])]
      if(current){
        // Leave historical weekly snapshots/events intact. FK SET NULL retains the undo authority on the event.
        statements.push(db.prepare('DELETE FROM inventory_menu_links WHERE inventory_item_id=? AND household_id=?'+(kept.length?' AND id NOT IN ('+kept.map(()=>'?').join(',')+')':'')).bind(itemId!,householdId,...kept))
        // Release every retained reservation before changing absolute stock/daily settings.
        statements.push(db.prepare('UPDATE inventory_menu_links SET remaining_count=0 WHERE inventory_item_id=? AND household_id=?').bind(itemId!,householdId))
        statements.push(db.prepare('UPDATE inventory_items SET name=?,normalized_name=?,category_id=?,store_id=?,price=?,quantity_tenths=?,threshold_tenths=?,daily_consumption_tenths=?,auto_consumption_enabled=?,last_consumed_on=?,consumption_revision=consumption_revision+?,menu_plan_enabled=? WHERE id=? AND household_id=?').bind(input.name.trim(),input.normalizedName,input.categoryId,input.storeId,input.price===undefined?current.price:input.price,effectiveQuantity,toTenths(input.threshold),daily,enabled?1:0,baseline,changed?1:0,input.menuPlan.enabled?1:0,itemId!,householdId),...inventoryShoppingSync(db,itemId!,householdId))
      }else{
        statements.push(db.prepare('INSERT INTO inventory_items(household_id,name,normalized_name,category_id,store_id,price,quantity_tenths,threshold_tenths,daily_consumption_tenths,auto_consumption_enabled,last_consumed_on,menu_plan_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(householdId,input.name.trim(),input.normalizedName,input.categoryId,input.storeId,input.price??null,effectiveQuantity,toTenths(input.threshold),daily,enabled?1:0,baseline,input.menuPlan.enabled?1:0),...inventoryShoppingSync(db,null,householdId))
      }
      statements.push(db.prepare("UPDATE menu_operation_requests SET response_json='{\"links\":[]}' WHERE "+requestRow))
      for(const [index,line] of input.menuPlan.links.entries()){
        let linkSql:string
        if('linkId' in line){
          linkSql=String(line.linkId)
          statements.push(db.prepare('UPDATE inventory_menu_links SET remaining_count=?,memo=?,carry_enabled=?,enabled=CASE WHEN recipe_id IS NULL THEN 0 ELSE 1 END,revision=revision+1 WHERE id=? AND inventory_item_id='+target+' AND household_id=?').bind(line.remainingCount,line.memo,line.carryEnabled?1:0,line.linkId,householdId),menuGuard(db,scope,requestId,'changes()=1',[]))
        }else{
          if('newRecipeTitle' in line)statements.push(db.prepare("INSERT INTO recipes(household_id,created_by_user_id,title,source_type) VALUES(?,?,?,'manual')").bind(householdId,actorUserId,line.newRecipeTitle))
          const recipe='recipeId' in line?'?':'last_insert_rowid()'
          statements.push(db.prepare('INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,usage_tenths,enabled,carry_enabled,starts_on,remaining_count,memo) SELECT ?,'+target+',r.id,r.title,10,1,?,?,?,? FROM recipes r WHERE r.id='+recipe+' AND r.household_id=?').bind(householdId,line.carryEnabled?1:0,week,line.remainingCount,line.memo,...('recipeId' in line?[line.recipeId]:[]),householdId),menuGuard(db,scope,requestId,'changes()=1',[]))
          linkSql=capturedLink(index)
        }
        statements.push(db.prepare("UPDATE menu_operation_requests SET response_json=json_insert(response_json,'$.links[#]',"+('linkId' in line?String(line.linkId):'last_insert_rowid()')+") WHERE "+requestRow))
        orderedLinks.push(linkSql)
        // New rows use one stock unit. Existing weekly usage and title snapshots are immutable.
        statements.push(db.prepare('INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) SELECT l.household_id,l.recipe_id,?,l.id,10,COALESCE(r.title,l.recipe_title_snapshot) FROM inventory_menu_links l LEFT JOIN recipes r ON r.id=l.recipe_id WHERE l.id='+linkSql+' AND l.inventory_item_id='+target+' AND l.remaining_count>0 AND l.enabled=1 AND ?=1 ON CONFLICT(inventory_menu_link_id,week_start_date) DO NOTHING').bind(week,input.menuPlan.enabled?1:0))
      }
      statements.push(menuGuard(db,scope,requestId,'EXISTS(SELECT 1 FROM inventory_items i WHERE i.id='+target+' AND i.household_id=? AND i.quantity_tenths>=(SELECT COALESCE(SUM(remaining_count),0)*10 FROM inventory_menu_links WHERE inventory_item_id=i.id) AND (i.auto_consumption_enabled=0 OR NOT EXISTS(SELECT 1 FROM inventory_menu_links WHERE inventory_item_id=i.id AND remaining_count>0)))',[householdId]))
      statements.push(finalizeMenuOperation(db,scope,requestId,current?200:201,inventoryMenuPlanResponseSql(target,orderedLinks,week),[]))
      // Compare the stored success against live rows inside this transaction, after any response trigger.
      const successLinks=orderedLinks.map((_id,index)=>"(SELECT json_extract(response_json,'$.menuLinks["+index+"].id') FROM menu_operation_requests WHERE "+requestRow+")")
      statements.push(menuGuard(db,scope,requestId,"EXISTS(SELECT 1 FROM menu_operation_requests s WHERE "+requestRow+" AND response_status=? AND json_array_length(response_json,'$.menuLinks')=? AND response_json=("+inventoryMenuPlanResponseSql(target,successLinks,week)+"))",[current?200:201,input.menuPlan.links.length]))
      return statements
    })
  }catch(error){
    if(error instanceof Error&&error.message.includes('UNIQUE constraint failed: inventory_items.'))return fail(duplicate())
    if(isMenuConflict(error))return fail(menuConflict())
    throw error
  }
}
function sqlText(value:string):string {return "'"+value.replaceAll("'","''")+"'"}
/** The SQL is evaluated inside the mutation batch; the ledger holds the committed snapshot. */
export function inventoryMenuPlanResponseSql(target:string,orderedLinks:string[],week:string):string {
  // The explicit submitted order is persisted in the immutable operation response.
  const ordering=orderedLinks.length?'CASE l.id '+orderedLinks.map((id,index)=>'WHEN '+id+' THEN '+index).join(' ')+' END':'l.id'
  return `SELECT json_object('id',i.id,'name',i.name,'categoryId',i.category_id,'storeId',i.store_id,'quantity',i.quantity_tenths/10.0,'threshold',i.threshold_tenths/10.0,'price',i.price,'dailyConsumption',i.daily_consumption_tenths/10.0,'autoConsumptionEnabled',json(CASE WHEN i.auto_consumption_enabled THEN 'true' ELSE 'false' END),'menuPlanEnabled',json(CASE WHEN i.menu_plan_enabled THEN 'true' ELSE 'false' END),'menuPlanRevision',i.menu_plan_revision,'menuLinks',json((SELECT json_group_array(json_object('id',l.id,'recipeId',l.recipe_id,'recipeTitle',COALESCE(r.title,l.recipe_title_snapshot),'usageQuantity',l.usage_tenths/10.0,'enabled',json(CASE WHEN l.enabled THEN 'true' ELSE 'false' END),'carryEnabled',json(CASE WHEN l.carry_enabled THEN 'true' ELSE 'false' END),'revision',l.revision,'remainingCount',l.remaining_count,'memo',l.memo)) FROM (SELECT * FROM inventory_menu_links l WHERE l.inventory_item_id=i.id ORDER BY ${ordering}) l LEFT JOIN recipes r ON r.id=l.recipe_id)),'linkedMenuEntries',json((SELECT json_group_array(json_object('id',e.id,'recipeId',e.recipe_id,'recipeTitle',e.recipe_title_snapshot,'weekStartDate',e.week_start_date,'usageQuantity',e.usage_tenths/10.0)) FROM menu_entries e JOIN inventory_menu_links l ON l.id=e.inventory_menu_link_id WHERE l.inventory_item_id=i.id AND e.week_start_date=${sqlText(week)}))) FROM inventory_items i WHERE i.id=${target}`
}
