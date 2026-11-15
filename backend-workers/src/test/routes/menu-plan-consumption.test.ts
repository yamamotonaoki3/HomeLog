import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { consumeMenuEntry, undoMenuConsumption } from '../../lib/menu-inventory-consumption'
import { currentWeekStart, getJstToday, formatJstToday } from '../../lib/date'
import type { MenuScope } from '../../lib/menu-operation-requests'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'

let scope:MenuScope,itemId:number,linkId:number,entryId:number,otherLinkId:number,otherEntryId:number,recipeId:number
const input=(expectedRevision=0)=>({requestId:crypto.randomUUID(),expectedRevision})
async function row(table:string,id:number){return env.DB.prepare('SELECT * FROM '+table+' WHERE id=?').bind(id).first<Record<string,unknown>>()}
async function state(){
 return {
  item:await row('inventory_items',itemId),link:await row('inventory_menu_links',linkId),other:await row('inventory_menu_links',otherLinkId),entry:await row('menu_entries',entryId),
  events:(await env.DB.prepare('SELECT * FROM menu_consumption_events WHERE household_id=? ORDER BY id').bind(scope.householdId).all()).results,
  requests:(await env.DB.prepare('SELECT * FROM menu_operation_requests WHERE household_id=? ORDER BY request_id').bind(scope.householdId).all()).results,
  shopping:(await env.DB.prepare('SELECT * FROM shopping_list_items WHERE household_id=? ORDER BY id').bind(scope.householdId).all()).results,
 }
}
beforeEach(async()=>{
 const user=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_plan_meal') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 const house=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] plan meals',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!
 scope={actorUserId:user.id,householdId:house.id}
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(house.id,user.id).run()
 const cat=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food') RETURNING id").bind(house.id).first<{id:number}>())!
 itemId=(await env.DB.prepare("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths,menu_plan_enabled) VALUES(?,'[E2E_TEST] chicken',?,50,30,1) RETURNING id").bind(house.id,cat.id).first<{id:number}>())!.id
 const ids=[]
 for(const [title,count] of [['[E2E_TEST] curry',2],['[E2E_TEST] oyakodon',3]] as const){
  const recipe=(await env.DB.prepare('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,?) RETURNING id').bind(house.id,user.id,title).first<{id:number}>())!
  const link=(await env.DB.prepare('INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count,carry_enabled) VALUES(?,?,?,?,?,?,1) RETURNING id').bind(house.id,itemId,recipe.id,title,currentWeekStart(getJstToday()),count).first<{id:number}>())!
  const entry=(await env.DB.prepare('INSERT INTO menu_entries(household_id,recipe_id,recipe_title_snapshot,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,?,?,?,?,5) RETURNING id').bind(house.id,recipe.id,title,currentWeekStart(getJstToday()),link.id).first<{id:number}>())!
  ids.push({recipe:recipe.id,link:link.id,entry:entry.id})
 }
 recipeId=ids[0].recipe;linkId=ids[0].link;entryId=ids[0].entry;otherLinkId=ids[1].link;otherEntryId=ids[1].entry
})
it('stock5 A2/B3を固定1で反復消費しA0で停止、保存成功は最新状態から再計算しない',async()=>{
 const firstInput=input(),first=await consumeMenuEntry(env.DB,scope,entryId,firstInput)
 expect(first.status).toBe(200)
 expect(first.body).toMatchObject({quantity:4,remainingCount:1,mealRevision:1,menuPlanRevision:expect.any(Number)})
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:40})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:1})
 expect(await row('inventory_menu_links',otherLinkId)).toMatchObject({remaining_count:3})
 const second=await consumeMenuEntry(env.DB,scope,entryId,input(1))
 expect(second.status).toBe(200);expect(second.body).toMatchObject({quantity:3,remainingCount:0,mealRevision:2})
 expect((await row('inventory_items',itemId))?.menu_plan_revision).toBe((second.body as {menuPlanRevision:number}).menuPlanRevision)
 expect(await consumeMenuEntry(env.DB,scope,entryId,firstInput)).toEqual(first)
 const before=await state()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(2))).status).toBe(409)
 expect(await state()).toEqual(before)
 expect(await row('menu_entries',entryId)).toMatchObject({usage_tenths:5})
})
it('同一要求の真の並行実行は一イベント、残1へ異なる要求は一方だけ成功する',async()=>{
 const req=input(),same=await Promise.all([consumeMenuEntry(env.DB,scope,entryId,req),consumeMenuEntry(env.DB,scope,entryId,req)])
 expect(same[0].status).toBe(200);expect(same[0]).toEqual(same[1])
 const competing=await Promise.all([consumeMenuEntry(env.DB,scope,entryId,input(1)),consumeMenuEntry(env.DB,scope,entryId,input(1))])
 expect(competing.map(x=>x.status).sort()).toEqual([200,409])
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:30})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:0})
 expect((await state()).events).toHaveLength(2)
})
it('同じ在庫の別行を同時消費しても全割当と在庫を保ち他在庫の同原本は変えない',async()=>{
 const item=await row('inventory_items',itemId)
 const otherItem=(await env.DB.prepare("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths,menu_plan_enabled) VALUES(?,'[E2E_TEST] other stock',?,20,0,1) RETURNING id").bind(scope.householdId,item!.category_id).first<{id:number}>())!
 const other=(await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count) VALUES(?,?,?,'[E2E_TEST] curry',?,2) RETURNING id").bind(scope.householdId,otherItem.id,recipeId,currentWeekStart(getJstToday())).first<{id:number}>())!
 const untouched=await row('inventory_menu_links',other.id)
 const results=await Promise.all([consumeMenuEntry(env.DB,scope,entryId,input()),consumeMenuEntry(env.DB,scope,otherEntryId,input())])
 expect(results.map(x=>x.status)).toEqual([200,200])
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:30})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:1})
 expect(await row('inventory_menu_links',otherLinkId)).toMatchObject({remaining_count:2})
 expect(await row('inventory_menu_links',other.id)).toEqual(untouched)
 expect(await row('inventory_items',otherItem.id)).toMatchObject({quantity_tenths:20})
})
it('同秒イベントもpointer順でLIFO取消し、現在在庫へ差分返却し再送と再取消で二重返却しない',async()=>{
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 const e1=(await row('menu_entries',entryId))!.consumed_event_id
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(200)
 const e2=(await row('menu_entries',entryId))!.consumed_event_id
 await env.DB.prepare("UPDATE menu_consumption_events SET created_at='2026-11-16 00:00:00' WHERE menu_entry_id=?").bind(entryId).run()
 expect(await env.DB.prepare('SELECT previous_event_id,quantity_tenths,plan_count_delta,inventory_menu_link_id FROM menu_consumption_events WHERE id=?').bind(e2).first()).toEqual({previous_event_id:e1,quantity_tenths:10,plan_count_delta:1,inventory_menu_link_id:linkId})
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=quantity_tenths+20 WHERE id=?').bind(itemId).run()
 const req=input(2),undo=await undoMenuConsumption(env.DB,scope,entryId,req)
 expect(undo.status).toBe(200);expect(undo.body).toMatchObject({quantity:6,remainingCount:1,mealRevision:3})
 expect(await row('menu_entries',entryId)).toMatchObject({consumed_event_id:e1})
 expect(await undoMenuConsumption(env.DB,scope,entryId,req)).toEqual(undo)
 const before=await state();expect((await undoMenuConsumption(env.DB,scope,entryId,input(2))).status).toBe(409);expect(await state()).toEqual(before)
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(3))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:70})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:2})
 expect(await row('menu_entries',entryId)).toMatchObject({consumed_event_id:null,meal_revision:4})
 const done=await state();expect((await undoMenuConsumption(env.DB,scope,entryId,input(4))).status).toBe(409);expect(await state()).toEqual(done)
})
it('品目OFFは新消費を拒否し並行取消は一度だけcountも返す',async()=>{
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 await env.DB.prepare('UPDATE inventory_items SET menu_plan_enabled=0 WHERE id=?').bind(itemId).run()
 const before=await state();expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(409);expect(await state()).toEqual(before)
 const results=await Promise.all([undoMenuConsumption(env.DB,scope,entryId,input(1)),undoMenuConsumption(env.DB,scope,entryId,input(1))])
 expect(results.map(x=>x.status).sort()).toEqual([200,409])
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50,menu_plan_enabled:0})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:2})
})
it('予定消費完了後に明示dailyONなら取消は409全rollbackしdailyを勝手にOFFにしない',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=0 WHERE id=?').bind(otherLinkId).run()
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=1 WHERE id=?').bind(linkId).run()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 await env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=1,daily_consumption_tenths=10,last_consumed_on=? WHERE id=?').bind(formatJstToday(),itemId).run()
 const before=await state()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409)
 expect(await state()).toEqual(before)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:40,auto_consumption_enabled:1,daily_consumption_tenths:10})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:0})
})
it('解除後も週snapshotとstackを保持しstockのみ返し、同原本を再追加した別IDには触れない',async()=>{
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(200)
 const top=(await row('menu_entries',entryId))!.consumed_event_id
 await env.DB.prepare('DELETE FROM inventory_menu_links WHERE id=?').bind(linkId).run()
 const added=(await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count,carry_enabled) VALUES(?,?,?,'[E2E_TEST] new title',?,0,1) RETURNING id").bind(scope.householdId,itemId,recipeId,currentWeekStart(getJstToday())).first<{id:number}>())!
 const untouched=await row('inventory_menu_links',added.id)
 expect(await row('menu_entries',entryId)).toMatchObject({inventory_menu_link_id:null,consumed_event_id:top,recipe_title_snapshot:'[E2E_TEST] curry'})
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(2))).status).toBe(200)
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(3))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50})
 expect(await row('inventory_menu_links',added.id)).toEqual(untouched)
 expect((await state()).events.every(e=>e.inventory_menu_link_id===null&&e.menu_entry_id===entryId)).toBe(true)
})
it.each([5,15])('legacy usage%sは旧量消費・旧成功JSONを保持し変換後もstockだけ返す',async usage=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=NULL,usage_tenths=? WHERE id=?').bind(usage,linkId).run()
 await env.DB.prepare('UPDATE menu_entries SET usage_tenths=? WHERE id=?').bind(usage,entryId).run()
 await env.DB.prepare('UPDATE inventory_items SET menu_plan_enabled=0 WHERE id=?').bind(itemId).run()
 const req=input(),consumed=await consumeMenuEntry(env.DB,scope,entryId,req)
 expect(consumed.status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50-usage})
 const ledger=await env.DB.prepare('SELECT request_json,response_json FROM menu_operation_requests WHERE request_id=?').bind(req.requestId).first()
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=0 WHERE id=?').bind(linkId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:0,usage_tenths:usage})
 expect(await consumeMenuEntry(env.DB,scope,entryId,req)).toEqual(consumed)
 expect(await env.DB.prepare('SELECT request_json,response_json FROM menu_operation_requests WHERE request_id=?').bind(req.requestId).first()).toEqual(ledger)
})
it('legacy消費でplanned予約を割る場合は既知409で全rollbackする',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=NULL WHERE id=?').bind(linkId).run()
 await env.DB.prepare('UPDATE menu_entries SET usage_tenths=25 WHERE id=?').bind(entryId).run()
 const before=await state()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(409)
 expect(await state()).toEqual(before)
})
it('旧previous未設定eventの0.5取消はlink解除後にも元stockのみ返す',async()=>{
 const event=crypto.randomUUID()
 await env.DB.prepare('INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths) VALUES(?,?,?,?,5)').bind(event,scope.householdId,entryId,itemId).run()
 await env.DB.prepare("UPDATE menu_entries SET meal_state='eaten',consumed_event_id=?,meal_revision=1 WHERE id=?").bind(event,entryId).run()
 await env.DB.prepare('DELETE FROM inventory_menu_links WHERE id=?').bind(linkId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:55})
 expect(await row('menu_entries',entryId)).toMatchObject({consumed_event_id:null})
})
it('取消上限と在庫削除は全未反映で新規作成しない',async()=>{
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=?').bind(itemId).run()
 const before=await state();expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409);expect(await state()).toEqual(before)
 await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(itemId).run()
 const deleted=await state();expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409);expect(await state()).toEqual(deleted)
})
it.each(['2020-01-06','2099-01-05'])('planned新要求は当週以外%sを拒否し、保存済再送は週変更・削除後も再現する',async week=>{
 const req=input(),success=await consumeMenuEntry(env.DB,scope,entryId,req)
 expect(success.status).toBe(200)
 await env.DB.prepare('UPDATE menu_entries SET week_start_date=? WHERE id=?').bind(week,entryId).run()
 const before=await state();expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(409);expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409);expect(await state()).toEqual(before)
 expect(await consumeMenuEntry(env.DB,scope,entryId,req)).toEqual(success)
 await env.DB.prepare('DELETE FROM menu_entries WHERE id=?').bind(entryId).run()
 expect(await consumeMenuEntry(env.DB,scope,entryId,req)).toEqual(success)
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(404)
})
it.each(['event','top','response'])('%s確定の障害はcount/stock/shopping/event/top/台帳を全rollbackする',async stage=>{
 await env.DB.prepare('UPDATE inventory_items SET threshold_tenths=40 WHERE id=?').bind(itemId).run()
 const trigger=stage==='event'
  ? "BEFORE INSERT ON menu_consumption_events"
  : stage==='top'?"BEFORE UPDATE OF consumed_event_id ON menu_entries":"BEFORE UPDATE OF response_json ON menu_operation_requests WHEN NEW.response_status=200"
 await env.DB.exec("CREATE TRIGGER test_plan_meal_failure "+trigger+" BEGIN SELECT RAISE(ABORT,'menu_operation_guard'); END")
 const before=await state()
 try{expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(409);expect(await state()).toEqual(before)}
 finally{await env.DB.exec('DROP TRIGGER test_plan_meal_failure')}
})
it.each(['event','top','response'])('取消の%s確定障害は返却stock/countとshopping削除も全rollbackする',async stage=>{
 await env.DB.prepare('UPDATE inventory_items SET threshold_tenths=40 WHERE id=?').bind(itemId).run()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 expect((await state()).shopping).toHaveLength(1)
 const trigger=stage==='event'
  ? 'BEFORE UPDATE OF undone_at ON menu_consumption_events'
  : stage==='top'?'BEFORE UPDATE OF consumed_event_id ON menu_entries':'BEFORE UPDATE OF response_json ON menu_operation_requests WHEN NEW.response_status=200'
 await env.DB.exec("CREATE TRIGGER test_plan_undo_failure "+trigger+" BEGIN SELECT RAISE(ABORT,'menu_operation_guard'); END")
 const before=await state()
 try{expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409);expect(await state()).toEqual(before)}
 finally{await env.DB.exec('DROP TRIGGER test_plan_undo_failure')}
})
it('planned取消も同一要求の真の並行実行では一度だけ返却する',async()=>{
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 const req=input(1),results=await Promise.all([undoMenuConsumption(env.DB,scope,entryId,req),undoMenuConsumption(env.DB,scope,entryId,req)])
 expect(results[0].status).toBe(200);expect(results[0]).toEqual(results[1])
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:2})
 expect((await state()).requests).toHaveLength(2)
})
it('legacy0.5の上へplanned1を積み、取消は新countのみ戻して旧実量も保存する',async()=>{
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=NULL WHERE id=?').bind(linkId).run()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(200)
 const legacy=(await row('menu_entries',entryId))!.consumed_event_id
 await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=1 WHERE id=?').bind(linkId).run()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:35})
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(2))).status).toBe(200)
 expect(await row('menu_entries',entryId)).toMatchObject({consumed_event_id:legacy})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:1})
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(3))).status).toBe(200)
 expect(await row('inventory_items',itemId)).toMatchObject({quantity_tenths:50})
 expect(await row('inventory_menu_links',linkId)).toMatchObject({remaining_count:1})
 expect((await state()).events.map(e=>e.quantity_tenths).sort()).toEqual([5,10].sort())
})
it('古いversion1成功JSONは行削除後もそのまま返し、残された台帳を変更しない',async()=>{
 const req=input(7),requestJson=JSON.stringify({version:1,operation:'undo',entryId,expectedRevision:7})
 const responseJson='{ "menuEntryId": '+entryId+', "quantity": 1.5, "carryEnabled": false }'
 await env.DB.prepare('INSERT INTO menu_operation_requests(household_id,actor_user_id,request_id,request_json,response_status,response_json) VALUES(?,?,?,?,200,?)').bind(scope.householdId,scope.actorUserId,req.requestId,requestJson,responseJson).run()
 await env.DB.prepare('DELETE FROM menu_entries WHERE id=?').bind(entryId).run()
 expect(await undoMenuConsumption(env.DB,scope,entryId,req)).toEqual({status:200,body:{menuEntryId:entryId,quantity:1.5,carryEnabled:false}})
 expect(await env.DB.prepare('SELECT request_json,response_json FROM menu_operation_requests WHERE request_id=?').bind(req.requestId).first()).toEqual({request_json:requestJson,response_json:responseJson})
})
it('HTTP consume/undoは現在所属を確認してから反復処理と保存結果を返す',async()=>{
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+await signAccessToken(scope.actorUserId,env.JWT_SECRET,900)}
 const req=input(),send=(operation:string,body:unknown)=>app.request('/api/menu-entries/'+entryId+'/'+operation,{method:'POST',headers,body:JSON.stringify(body)},env)
 const first=await send('consume',req)
 expect(first.status).toBe(200);expect(await first.json()).toMatchObject({quantity:4,remainingCount:1,mealRevision:1})
 const undo=await send('undo-consumption',input(1))
 expect(undo.status).toBe(200);expect(await undo.json()).toMatchObject({quantity:5,remainingCount:2,mealRevision:2})
 await env.DB.prepare('DELETE FROM household_members WHERE household_id=? AND user_id=?').bind(scope.householdId,scope.actorUserId).run()
 const before=await state()
 expect((await send('consume',req)).status).toBe(404)
 expect(await state()).toEqual(before)
})
