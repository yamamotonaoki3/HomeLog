import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import app from '../../index'
import { currentWeekStart, formatJstToday, getJstToday } from '../../lib/date'
import { signAccessToken } from '../../lib/jwt'
import { consumeMenuEntry, undoMenuConsumption } from '../../lib/menu-inventory-consumption'
import type { MenuInventoryLinkage } from '../../lib/menu-inventory-consumption'

let home:number,user:number,category:number,item:number,recipe:number,link:number,entry:number,headers:Record<string,string>
const week=()=>currentWeekStart(getJstToday())
async function insert(sql:string,...args:(number|string|null)[]){return (await env.DB.prepare(sql+' RETURNING id').bind(...args).first<{id:number}>())!.id}
async function list(targetWeek=week()){
 const response=await app.request('/api/menu-entries?weekStartDate='+targetWeek,{headers},env)
 expect(response.status).toBe(200)
 return response.json<{id:number;recipeTitle:string|null;inventoryLinkage:MenuInventoryLinkage|null}[]>()
}
async function linkage(){return (await list()).find(row=>row.id===entry)!.inventoryLinkage!}
async function consume(revision=0){expect((await consumeMenuEntry(env.DB,{householdId:home,actorUserId:user},entry,{requestId:crypto.randomUUID(),expectedRevision:revision})).status).toBe(200)}
beforeEach(async()=>{
 user=await insert("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_projection')",'testuser_'+crypto.randomUUID()+'@example.com')
 home=await insert("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] projections',?)",crypto.randomUUID())
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(home,user).run()
 category=await insert("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food')",home)
 item=await insert("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths,menu_plan_enabled) VALUES(?,'[E2E_TEST] stock',?,50,0,1)",home,category)
 recipe=await insert("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] original')",home,user)
 link=await insert("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count,memo,carry_enabled) VALUES(?,?,?,'[E2E_TEST] saved link',?,2,'[E2E_TEST] spicy',1)",home,item,recipe,week())
 entry=await insert("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) VALUES(?,?,?,?,5,'[E2E_TEST] weekly')",home,recipe,week(),link)
 headers={Authorization:'Bearer '+await signAccessToken(user,env.JWT_SECRET,900)}
})

it('inventory GET adds current count/memo and item metadata without reinterpreting legacy usage or ordinary items',async()=>{
 const legacyRecipe=await insert("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] legacy')",home,user)
 const legacy=await insert("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,usage_tenths,enabled) VALUES(?,?,?,'[E2E_TEST] legacy',?,20,0)",home,item,legacyRecipe,week())
 const ordinary=await insert("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(?,'[E2E_TEST] ordinary',?,10,0)",home,category)
 const response=await app.request('/api/inventory-items',{headers},env)
 expect(response.status).toBe(200)
 const rows=await response.json<{id:number;menuPlanEnabled:boolean;menuPlanRevision:number;menuLinks:unknown[]}[]>()
 const current=rows.find(row=>row.id===item)!
 expect(current).toMatchObject({menuPlanEnabled:true,menuPlanRevision:expect.any(Number)})
 expect(Number.isSafeInteger(current.menuPlanRevision)).toBe(true)
 expect(current.menuLinks).toEqual([
  expect.objectContaining({id:link,recipeTitle:'[E2E_TEST] original',remainingCount:2,memo:'[E2E_TEST] spicy'}),
  expect.objectContaining({id:legacy,usageQuantity:2,enabled:false,remainingCount:null,memo:null}),
 ])
 expect(rows.find(row=>row.id===ordinary)).toMatchObject({menuPlanEnabled:false,menuPlanRevision:0,menuLinks:[]})
})
it('planned GET keeps live count/memo and allows repeated consume and partial undo independently of eaten state',async()=>{
 expect(await linkage()).toMatchObject({remainingCount:2,memo:'[E2E_TEST] spicy',menuPlanEnabled:true,menuPlanRevision:expect.any(Number),canConsume:true,canUndo:false,undoQuantity:null})
 await consume()
 expect(await linkage()).toMatchObject({remainingCount:1,mealState:'eaten',canConsume:true,canUndo:true,undoQuantity:1,quantity:4})
 await env.DB.prepare('UPDATE inventory_items SET menu_plan_enabled=0 WHERE id=?').bind(item).run()
 expect(await linkage()).toMatchObject({remainingCount:1,memo:'[E2E_TEST] spicy',menuPlanEnabled:false,canConsume:false,canUndo:true,undoQuantity:1})
})
it('past/future plans never expose current link count or memo as a historical snapshot',async()=>{
 for(const targetWeek of ['2020-01-06','2099-01-05']){
  const old=await insert("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) VALUES(?,?,?,?,10,'[E2E_TEST] past')",home,recipe,targetWeek,link)
  expect((await list(targetWeek)).find(row=>row.id===old)!.inventoryLinkage).toMatchObject({remainingCount:null,memo:null,canConsume:false,canUndo:false,undoQuantity:null})
 }
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=1,memo=? WHERE id=?').bind('[E2E_TEST] changed',link).run()
 expect((await list('2020-01-06'))[0].inventoryLinkage).toMatchObject({remainingCount:null,memo:null})
})
it('detached event keeps stock-only undo, null live metadata and weekly title in all three projections',async()=>{
 const normal=await insert('INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES(?,?,?)',home,recipe,week())
 await consume()
 await env.DB.prepare('DELETE FROM inventory_menu_links WHERE id=?').bind(link).run()
 await insert("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count) VALUES(?,?,?,'[E2E_TEST] re-added',?,1)",home,item,recipe,week())
 await env.DB.prepare("UPDATE recipes SET title='[E2E_TEST] renamed' WHERE id=?").bind(recipe).run()
 expect(await linkage()).toMatchObject({linkId:null,remainingCount:null,memo:null,menuPlanEnabled:null,menuPlanRevision:null,canConsume:false,canUndo:true,undoQuantity:1,inventoryItemId:item,quantity:4,carryEnabled:false,linkRevision:null})
 expect((await list()).find(row=>row.id===entry)!.recipeTitle).toBe('[E2E_TEST] weekly')
 expect((await list()).find(row=>row.id===normal)!.recipeTitle).toBe('[E2E_TEST] renamed')
 const summary=await (await app.request('/api/dashboard/summary',{headers},env)).json<{weeklyMenuEntries:{recipeTitle:string|null}[]}>()
 expect(summary.weeklyMenuEntries.map(row=>row.recipeTitle)).toEqual(['[E2E_TEST] weekly','[E2E_TEST] renamed'])
 const day=await (await app.request('/api/dashboard/day-detail?date='+formatJstToday(),{headers},env)).json<{menuEntries:{recipeTitle:string|null}[]}>()
 expect(day.menuEntries.map(row=>row.recipeTitle)).toEqual(['[E2E_TEST] weekly','[E2E_TEST] renamed'])
 await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipe).run()
 expect((await list()).map(row=>row.recipeTitle)).toEqual(['[E2E_TEST] weekly',null])
 const deletedSummary=await (await app.request('/api/dashboard/summary',{headers},env)).json<{weeklyMenuEntries:{recipeTitle:string|null}[]}>()
 expect(deletedSummary.weeklyMenuEntries.map(row=>row.recipeTitle)).toEqual(['[E2E_TEST] weekly',null])
 const deletedDay=await (await app.request('/api/dashboard/day-detail?date='+formatJstToday(),{headers},env)).json<{menuEntries:{recipeTitle:string|null}[]}>()
 expect(deletedDay.menuEntries.map(row=>row.recipeTitle)).toEqual(['[E2E_TEST] weekly',null])
})
it('legacy half-unit top remains the undo amount after explicit conversion and while daily is ON',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=NULL,memo=NULL WHERE id=?').bind(link).run()
 await consume()
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=0 WHERE id=?').bind(link).run()
 await env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=1,daily_consumption_tenths=1,last_consumed_on=? WHERE id=?').bind(formatJstToday(),item).run()
 expect(await linkage()).toMatchObject({remainingCount:0,canConsume:false,canUndo:true,undoQuantity:0.5,quantity:4.5})
})
it('undoQuantity follows the actual mixed LIFO top after each refund and clears when the stack empties',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=NULL,memo=NULL WHERE id=?').bind(link).run()
 await consume()
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=2 WHERE id=?').bind(link).run()
 await consume(1)
 expect(await linkage()).toMatchObject({remainingCount:1,canConsume:true,canUndo:true,undoQuantity:1,quantity:3.5})
 expect((await undoMenuConsumption(env.DB,{householdId:home,actorUserId:user},entry,{requestId:crypto.randomUUID(),expectedRevision:2})).status).toBe(200)
 expect(await linkage()).toMatchObject({remainingCount:2,canUndo:true,undoQuantity:0.5,quantity:4.5})
 expect((await undoMenuConsumption(env.DB,{householdId:home,actorUserId:user},entry,{requestId:crypto.randomUUID(),expectedRevision:3})).status).toBe(200)
 expect(await linkage()).toMatchObject({remainingCount:2,canUndo:false,undoQuantity:null,quantity:5})
})
it('undo capability rejects a refund above stock maximum or an already undone top without exposing a refund amount',async()=>{
 await consume()
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=?').bind(item).run()
 expect(await linkage()).toMatchObject({canUndo:false,undoQuantity:null})
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=40 WHERE id=?').bind(item).run()
 await env.DB.prepare('UPDATE menu_consumption_events SET undone_at=? WHERE id=(SELECT consumed_event_id FROM menu_entries WHERE id=?)').bind(new Date().toISOString(),entry).run()
 expect(await linkage()).toMatchObject({canUndo:false,undoQuantity:null})
})
it('daily ON blocks count-restoring undo for its surviving original planned link but permits detached stock-only undo',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=1 WHERE id=?').bind(link).run()
 await consume()
 await env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=1,daily_consumption_tenths=1,last_consumed_on=? WHERE id=?').bind(formatJstToday(),item).run()
 expect(await linkage()).toMatchObject({remainingCount:0,canUndo:false,undoQuantity:null,unavailableReason:'daily_consumption'})
 await env.DB.prepare('DELETE FROM inventory_menu_links WHERE id=?').bind(link).run()
 expect(await linkage()).toMatchObject({linkId:null,canUndo:true,undoQuantity:1})
})
it('legacy consume capability includes other planned reservations rather than just available stock',async()=>{
 const legacyRecipe=await insert("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] legacy')",home,user)
 const legacy=await insert("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,usage_tenths) VALUES(?,?,?,'[E2E_TEST] legacy',?,40)",home,item,legacyRecipe,week())
 const legacyEntry=await insert("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) VALUES(?,?,?,?,40,'[E2E_TEST] legacy')",home,legacyRecipe,week(),legacy)
 expect((await list()).find(row=>row.id===legacyEntry)!.inventoryLinkage).toMatchObject({remainingCount:null,canConsume:false,canUndo:false,undoQuantity:null})
})
it('other household cannot read plan rows or detached undo stock',async()=>{
 await consume()
 await env.DB.prepare('DELETE FROM inventory_menu_links WHERE id=?').bind(link).run()
 const foreignUser=await insert("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_other_projection')",'testuser_'+crypto.randomUUID()+'@example.com')
 const foreignHome=await insert("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] other',?)",crypto.randomUUID())
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(foreignHome,foreignUser).run()
 headers={Authorization:'Bearer '+await signAccessToken(foreignUser,env.JWT_SECRET,900)}
 expect(await list()).toEqual([])
 expect(await (await app.request('/api/inventory-items',{headers},env)).json()).toEqual([])
})
