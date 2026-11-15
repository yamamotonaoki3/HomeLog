import { env } from 'cloudflare:test'
import {beforeEach,expect,it,vi} from 'vitest'
import app from '../../index'
import {signAccessToken} from '../../lib/jwt'
let headers:Record<string,string>,categoryId:number,recipeId:number,householdId:number
const request=(method:string,path:string,body?:unknown)=>app.request('/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},env)
beforeEach(async()=>{
 const u=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_menu') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 householdId=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] links',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!.id
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(householdId,u.id).run()
 categoryId=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] category') RETURNING id").bind(householdId).first<{id:number}>())!.id
 recipeId=(await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title,source_type,url) VALUES(?,?,'[E2E_TEST] existing','web','https://example.com/recipe') RETURNING id").bind(householdId,u.id).first<{id:number}>())!.id
 headers={'Content-Type':'application/json',Authorization:'Bearer '+await signAccessToken(u.id,env.JWT_SECRET,900)}
})
const body=()=>({name:'[E2E_TEST] chicken',categoryId,storeId:null,quantity:3,threshold:1,menuLinkage:{requestId:crypto.randomUUID(),menus:[{newRecipeTitle:'[E2E_TEST] ham',carryEnabled:true},{recipeId,usageQuantity:1},{newRecipeTitle:'[E2E_TEST] teriyaki',usageQuantity:1}]}})
it.each(['summary','day-detail'] as const)('dashboard %sは連携生成時名と通常行のlive名を改名・削除後も区別する',async endpoint=>{
 const {currentWeekStart,getJstToday}=await import('../../lib/date')
 const today=getJstToday()
 const week=currentWeekStart(today)
 const data={...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,carryEnabled:false}]}}
 const createdResponse=await request('POST','inventory-items',data)
 expect(createdResponse.status).toBe(201)
 const created=await createdResponse.json<{linkedMenuEntries:{id:number}[]}>()
 expect((await request('POST','menu-entries',{recipeId,weekStartDate:week})).status).toBe(201)
 expect((await request('POST','menu-entries/'+created.linkedMenuEntries[0].id+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(200)
 type MenuTitle={recipeId:number|null;recipeTitle:string|null}
 const list=async()=>{
  const path=endpoint==='summary'?'dashboard/summary':'dashboard/day-detail?date='+today.toISOString().slice(0,10)
  const response=await request('GET',path)
  expect(response.status).toBe(200)
  const result=await response.json<{weeklyMenuEntries?:MenuTitle[];menuEntries?:MenuTitle[]}>()
  const rows=endpoint==='summary'?result.weeklyMenuEntries:result.menuEntries
  expect(rows).toHaveLength(2)
  return rows!.map(row=>({recipeId:row.recipeId,recipeTitle:row.recipeTitle}))
 }
 expect(await list()).toEqual([
  {recipeId,recipeTitle:'[E2E_TEST] existing'},
  {recipeId,recipeTitle:'[E2E_TEST] existing'},
 ])
 await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] renamed',recipeId).run()
 expect(await list()).toEqual([
  {recipeId,recipeTitle:'[E2E_TEST] existing'},
  {recipeId,recipeTitle:'[E2E_TEST] renamed'},
 ])
 await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipeId).run()
 expect(await list()).toEqual([
  {recipeId:null,recipeTitle:'[E2E_TEST] existing'},
  {recipeId:null,recipeTitle:null},
 ])
})
it('連携の食済名は生成時を保持し、通常献立だけ改名に追随し削除後NULLになる',async()=>{
 const {currentWeekStart,getJstToday}=await import('../../lib/date')
 const week=currentWeekStart(getJstToday())
 const createdResponse=await request('POST','inventory-items',body())
 expect(createdResponse.status).toBe(201)
 const created=await createdResponse.json<{linkedMenuEntries:{id:number}[]}>()
 const linkedId=created.linkedMenuEntries[1].id
 const manualResponse=await request('POST','menu-entries',{recipeId,weekStartDate:week})
 expect(manualResponse.status).toBe(201)
 const manual=await manualResponse.json<{id:number}>()
 expect((await request('POST','menu-entries/'+linkedId+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(200)
 const list=async()=>{
  const response=await request('GET','menu-entries?weekStartDate='+week)
  expect(response.status).toBe(200)
  return response.json<{id:number;recipeId:number|null;recipeTitle:string|null;inventoryLinkage:{mealState:string;canConsume:boolean}|null}[]>()
 }
 expect((await list()).find(row=>row.id===linkedId)).toMatchObject({recipeTitle:'[E2E_TEST] existing',inventoryLinkage:{mealState:'eaten'}})
 await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] renamed',recipeId).run()
 let rows=await list()
 expect(rows.find(row=>row.id===linkedId)).toMatchObject({recipeId,recipeTitle:'[E2E_TEST] existing',inventoryLinkage:{mealState:'eaten'}})
 expect(rows.find(row=>row.id===manual.id)).toMatchObject({recipeId,recipeTitle:'[E2E_TEST] renamed',inventoryLinkage:null})
 await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipeId).run()
 rows=await list()
 expect(rows.find(row=>row.id===linkedId)).toMatchObject({recipeId:null,recipeTitle:'[E2E_TEST] existing',inventoryLinkage:{mealState:'eaten',canConsume:false}})
 expect(rows.find(row=>row.id===manual.id)).toMatchObject({recipeId:null,recipeTitle:null,inventoryLinkage:null})
})
it('再ONで欠損今週行に現在の原本名を保存し、同値・使用数編集で名前を上書きしない',async()=>{
 const data={...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,carryEnabled:false}]}}
 const createdResponse=await request('POST','inventory-items',data)
 expect(createdResponse.status).toBe(201)
 const created=await createdResponse.json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(created.id).first<{id:number}>())!
 const update=(expectedRevision:number,enabled:boolean,usageQuantity=1)=>request('PATCH','inventory-menu-links/'+link.id,{expectedRevision,enabled,usageQuantity,carryEnabled:false})
 expect((await update(0,false)).status).toBe(200)
 expect((await request('DELETE','menu-entries/'+created.linkedMenuEntries[0].id)).status).toBe(204)
 await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] at reactivation',recipeId).run()
 expect((await update(1,true)).status).toBe(200)
 const {currentWeekStart,getJstToday}=await import('../../lib/date')
 const list=async()=>{
  const response=await request('GET','menu-entries?weekStartDate='+currentWeekStart(getJstToday()))
  expect(response.status).toBe(200)
  return response.json<{id:number;recipeTitle:string;inventoryLinkage:{usageQuantity:number;mealRevision:number}}[]>()
 }
 const rows=await list()
 expect(rows).toHaveLength(1)
 expect(rows[0].recipeTitle).toBe('[E2E_TEST] at reactivation')
 await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] after reactivation',recipeId).run()
 for(const [revision,usageQuantity] of [[2,1],[3,2]] as const){
  expect((await update(revision,true,usageQuantity)).status).toBe(200)
  const updated=await list()
  expect(updated).toHaveLength(1)
  expect(updated[0]).toMatchObject({id:rows[0].id,recipeTitle:'[E2E_TEST] at reactivation',inventoryLinkage:{usageQuantity,mealRevision:revision-1}})
 }
})
it.each([false,true])('在庫0の持越しOFF再ONは409全未反映（batch直前の0更新=%s）',async race=>{
 const data={...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,carryEnabled:false}]}}
 const created=await (await request('POST','inventory-items',data)).json<{id:number}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(created.id).first<{id:number}>())!
 expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:0,usageQuantity:1,enabled:false,carryEnabled:false})).status).toBe(200)
 // Keep one current row to detect usage/revision writes and leave another link without a row to detect INSERTs.
 const snapshot=async()=>({link:await env.DB.prepare('SELECT * FROM inventory_menu_links WHERE id=?').bind(link.id).first(),meals:(await env.DB.prepare('SELECT * FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results})
 for(const keepRow of [true,false]){
  if(!keepRow)await env.DB.prepare('DELETE FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).run()
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=? WHERE id=?').bind(race?30:0,created.id).run()
  const before=await snapshot()
  const batch=env.DB.batch.bind(env.DB)
  const spy=race?vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
   await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=?').bind(created.id).run()
   return batch(statements)
  }):undefined
  let response:Response
  try{response=await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:1,usageQuantity:2,enabled:true,carryEnabled:false})}finally{spy?.mockRestore()}
  expect(response.status).toBe(409)
  expect(await snapshot()).toEqual(before)
  expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(created.id).first()).toEqual({quantity_tenths:0})
 }
})
it('初期在庫0/carryOFF登録と同値・使用数編集は成功し、削除済み週行は生成しない',async()=>{
 const data={...body(),quantity:0,menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,carryEnabled:false}]}}
 const response=await request('POST','inventory-items',data)
 expect(response.status).toBe(201)
 const created=await response.json<{id:number}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(created.id).first<{id:number}>())!
 for(const [expectedRevision,usageQuantity] of [[0,1],[1,2]] as const){
  expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision,usageQuantity,enabled:true,carryEnabled:false})).status).toBe(200)
  expect(await env.DB.prepare('SELECT usage_tenths,meal_revision FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).first()).toEqual({usage_tenths:usageQuantity*10,meal_revision:expectedRevision+1})
 }
 await env.DB.prepare('DELETE FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).run()
 for(const [expectedRevision,usageQuantity] of [[2,2],[3,3]] as const)expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision,usageQuantity,enabled:true,carryEnabled:false})).status).toBe(200)
 expect((await env.DB.prepare('SELECT id FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results).toEqual([])
 expect(await env.DB.prepare('SELECT revision,usage_tenths,enabled,carry_enabled FROM inventory_menu_links WHERE id=?').bind(link.id).first()).toEqual({revision:4,usage_tenths:30,enabled:1,carry_enabled:0})
})
it('新規/既存原本混在の並行同ID登録は在庫3のまま3献立だけ作る',async()=>{
 const data=body()
 const responses=await Promise.all([request('POST','inventory-items',data),request('POST','inventory-items',data)])
 expect(responses.map(r=>r.status)).toEqual([201,201])
 const results=await Promise.all(responses.map(r=>r.json<{id:number;quantity:number;linkedMenuEntries:unknown[]}>()))
 expect(results[0]).toEqual(results[1]);expect(results[0].quantity).toBe(3);expect(results[0].linkedMenuEntries).toHaveLength(3)
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM recipes WHERE household_id=?').bind(householdId).first()).toEqual({n:3})
 const list=await (await request('GET','inventory-items')).json<{menuLinks:unknown[]}[]>()
 expect(list[0].menuLinks).toHaveLength(3)
 expect((await request('POST','inventory-items',{...data,quantity:4})).status).toBe(409)
})
it('日次ON/不正原本/重複原本は全未作成で拒否し、使用予定の在庫超過は許可する',async()=>{
 const data=body()
 expect((await request('POST','inventory-items',{...data,dailyConsumption:1,autoConsumptionEnabled:true})).status).toBe(400)
 expect((await request('POST','inventory-items',{...data,menuLinkage:{...data.menuLinkage,menus:[{recipeId:999999}]}})).status).toBe(400)
 expect((await request('POST','inventory-items',{...data,menuLinkage:{...data.menuLinkage,menus:[{recipeId},{recipeId}]}})).status).toBe(400)
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_items WHERE household_id=?').bind(householdId).first()).toEqual({n:0})
 expect((await request('POST','inventory-items',{...data,quantity:0.1,menuLinkage:{...data.menuLinkage,menus:[{recipeId,usageQuantity:2}]}})).status).toBe(201)
})


it('実HTTPで当週能力とconsume/undo、連携PATCHのCASと認可を確認する',async()=>{
 const created=await (await request('POST','inventory-items',body())).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const week=(await import('../../lib/date')).currentWeekStart((await import('../../lib/date')).getJstToday())
 const menus=await (await request('GET','menu-entries?weekStartDate='+week)).json<{id:number;inventoryLinkage:{canConsume:boolean;canUndo:boolean;mealRevision:number;linkId:number;linkRevision:number}}[]>()
 expect(menus[0].inventoryLinkage).toMatchObject({canConsume:true,canUndo:false,mealRevision:0})
 const eat=await request('POST','menu-entries/'+created.linkedMenuEntries[0].id+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})
 expect(eat.status).toBe(200)
 const id=menus[0].inventoryLinkage.linkId
 expect((await request('PATCH','inventory-menu-links/'+id,{expectedRevision:0,usageQuantity:2,enabled:true,carryEnabled:true})).status).toBe(200)
 expect((await request('PATCH','inventory-menu-links/'+id,{expectedRevision:0,usageQuantity:3,enabled:true,carryEnabled:true})).status).toBe(409)
 expect((await request('POST','menu-entries/'+created.linkedMenuEntries[0].id+'/undo-consumption',{requestId:crypto.randomUUID(),expectedRevision:1})).status).toBe(200)
 expect((await app.request('/api/menu-entries/'+created.linkedMenuEntries[0].id+'/consume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:2})},env)).status).toBe(401)
})


it.each([0,-1,0.01,100000])('不正使用数%sを400で拒否する',async usageQuantity=>{
 const data=body()
 expect((await request('POST','inventory-items',{...data,menuLinkage:{...data.menuLinkage,menus:[{recipeId,usageQuantity}]}})).status).toBe(400)
})
it('日次ONへの切替は既存連携中拒否し、OFF後は既存設定を保持する',async()=>{
 const data=body()
 const item=await (await request('POST','inventory-items',data)).json<{id:number}>()
 const update={name:data.name,categoryId,storeId:null,threshold:1,dailyConsumption:0.1,autoConsumptionEnabled:true}
 expect((await request('PATCH','inventory-items/'+item.id,update)).status).toBe(400)
 const links=await env.DB.prepare('SELECT id,revision FROM inventory_menu_links WHERE inventory_item_id=?').bind(item.id).all<{id:number;revision:number}>()
 for(const link of links.results)expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:link.revision,usageQuantity:1,enabled:false,carryEnabled:false})).status).toBe(200)
 expect((await request('PATCH','inventory-items/'+item.id,update)).status).toBe(200)
})
it('在庫不足と他世帯IDの実食を拒否し、状態・数量・台帳を変えない',async()=>{
 const data=body()
 const item=await (await request('POST','inventory-items',{...data,quantity:0.1,menuLinkage:{...data.menuLinkage,menus:[{recipeId}]}})).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const entryId=item.linkedMenuEntries[0].id
 expect((await request('POST','menu-entries/'+entryId+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(409)
 expect(await env.DB.prepare('SELECT meal_state,meal_revision FROM menu_entries WHERE id=?').bind(entryId).first()).toEqual({meal_state:'uneaten',meal_revision:0})
 const other=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_other') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 const home=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] other',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(home.id,other.id).run()
 headers={...headers,Authorization:'Bearer '+await signAccessToken(other.id,env.JWT_SECRET,900)}
 expect((await request('POST','menu-entries/'+entryId+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(404)
 expect((await request('PATCH','inventory-menu-links/1',{expectedRevision:0,usageQuantity:1,enabled:false,carryEnabled:false})).status).toBe(404)
})


it('再ONは食済を復活せず、未食行だけ使用数更新し削除は数量を返さない',async()=>{
 const created=await (await request('POST','inventory-items',body())).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const list=await env.DB.prepare('SELECT id,revision FROM inventory_menu_links WHERE inventory_item_id=? ORDER BY id').bind(created.id).all<{id:number;revision:number}>()
 const first=created.linkedMenuEntries[0].id
 expect((await request('POST','menu-entries/'+first+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(200)
 expect((await request('PATCH','inventory-menu-links/'+list.results[0].id,{expectedRevision:0,usageQuantity:2,enabled:true,carryEnabled:true})).status).toBe(200)
 expect(await env.DB.prepare('SELECT meal_state,usage_tenths,meal_revision FROM menu_entries WHERE id=?').bind(first).first()).toEqual({meal_state:'eaten',usage_tenths:10,meal_revision:1})
 const second=created.linkedMenuEntries[1].id
 expect((await request('PATCH','inventory-menu-links/'+list.results[1].id,{expectedRevision:0,usageQuantity:2,enabled:true,carryEnabled:true})).status).toBe(200)
 expect(await env.DB.prepare('SELECT meal_state,usage_tenths,meal_revision FROM menu_entries WHERE id=?').bind(second).first()).toEqual({meal_state:'uneaten',usage_tenths:20,meal_revision:1})
 expect((await request('DELETE','menu-entries/'+first)).status).toBe(204)
 expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(created.id).first()).toEqual({quantity_tenths:20})
 expect(await env.DB.prepare('SELECT carry_enabled FROM inventory_menu_links WHERE id=?').bind(list.results[0].id).first()).toEqual({carry_enabled:0})
})


it('返却後の在庫上限を超える食済行はcanUndo=falseで取消409全未反映',async()=>{
 const created=await (await request('POST','inventory-items',body())).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const entryId=created.linkedMenuEntries[0].id
 await request('POST','menu-entries/'+entryId+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=?').bind(created.id).run()
 const {currentWeekStart,getJstToday}=await import('../../lib/date')
 const list=await (await request('GET','menu-entries?weekStartDate='+currentWeekStart(getJstToday()))).json<{id:number;inventoryLinkage:{canUndo:boolean}}[]>()
 expect(list.find(row=>row.id===entryId)!.inventoryLinkage.canUndo).toBe(false)
 expect((await request('POST','menu-entries/'+entryId+'/undo-consumption',{requestId:crypto.randomUUID(),expectedRevision:1})).status).toBe(409)
 expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(created.id).first()).toEqual({quantity_tenths:999999})
 expect(await env.DB.prepare('SELECT meal_state,meal_revision FROM menu_entries WHERE id=?').bind(entryId).first()).toEqual({meal_state:'eaten',meal_revision:1})
})

it('持越しOFFの連携再ONはcleanup後の今週行を一度だけ作り、通常設定変更は削除行を復活させない',async()=>{
 const data={...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,usageQuantity:1,carryEnabled:false}]}}
 const created=await (await request('POST','inventory-items',data)).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(created.id).first<{id:number}>())!
 const update=(expectedRevision:number,enabled:boolean,usageQuantity=1)=>request('PATCH','inventory-menu-links/'+link.id,{expectedRevision,enabled,usageQuantity,carryEnabled:false})
 expect((await update(0,false)).status).toBe(200)
 await env.DB.prepare("UPDATE menu_entries SET week_start_date='2020-01-06' WHERE inventory_menu_link_id=?").bind(link.id).run()
 const {purgePastMenuEntries}=await import('../../lib/menu-entry-cleanup')
 await purgePastMenuEntries(env.DB,new Date())
 expect((await update(1,true)).status).toBe(200)
 const rows=(await env.DB.prepare('SELECT id,meal_state,usage_tenths FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all<{id:number;meal_state:string;usage_tenths:number}>()).results
 expect(rows).toHaveLength(1)
 expect(rows[0]).toMatchObject({meal_state:'uneaten',usage_tenths:10})
 expect(await env.DB.prepare('SELECT carry_enabled FROM inventory_menu_links WHERE id=?').bind(link.id).first()).toEqual({carry_enabled:0})
 expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(created.id).first()).toEqual({quantity_tenths:30})
 expect((await update(2,true)).status).toBe(200)
 expect((await env.DB.prepare('SELECT id FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results).toEqual([{id:rows[0].id}])
 expect((await request('DELETE','menu-entries/'+rows[0].id)).status).toBe(204)
 expect((await update(3,true,2)).status).toBe(200)
 expect((await env.DB.prepare('SELECT id FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results).toEqual([])
})
it('連携OFFから持越しOFFの再ONでも既存食済行を未食に復活させない',async()=>{
 const data={...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,usageQuantity:1,carryEnabled:false}]}}
 const created=await (await request('POST','inventory-items',data)).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const entryId=created.linkedMenuEntries[0].id
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(created.id).first<{id:number}>())!
 expect((await request('POST','menu-entries/'+entryId+'/consume',{requestId:crypto.randomUUID(),expectedRevision:0})).status).toBe(200)
 for(const [expectedRevision,enabled] of [[0,false],[1,true]] as const)expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision,enabled,usageQuantity:2,carryEnabled:false})).status).toBe(200)
 expect((await env.DB.prepare('SELECT id,meal_state,usage_tenths,meal_revision FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results).toEqual([{id:entryId,meal_state:'eaten',usage_tenths:10,meal_revision:1}])
})
