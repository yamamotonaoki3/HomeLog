import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { consumeMenuEntry, undoMenuConsumption } from '../../lib/menu-inventory-consumption'
import { currentWeekStart,getJstToday } from '../../lib/date'
import type {MenuScope} from '../../lib/menu-operation-requests'
let scope:MenuScope,itemId:number,entryId:number,linkId:number
const input=(expectedRevision=0)=>({requestId:crypto.randomUUID(),expectedRevision})
beforeEach(async()=>{
 const user=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_menu') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 const house=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] menu',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!
 scope={actorUserId:user.id,householdId:house.id}
 const cat=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food') RETURNING id").bind(house.id).first<{id:number}>())!
 itemId=(await env.DB.prepare("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(?,'[E2E_TEST] chicken',?,30,10) RETURNING id").bind(house.id,cat.id).first<{id:number}>())!.id
 const recipe=(await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] ham') RETURNING id").bind(house.id,user.id).first<{id:number}>())!
 const week=currentWeekStart(getJstToday())
 linkId=(await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,carry_enabled) VALUES(?,?,?,'[E2E_TEST] ham',?,1) RETURNING id").bind(house.id,itemId,recipe.id,week).first<{id:number}>())!.id
 entryId=(await env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,?,?,?,10) RETURNING id").bind(house.id,recipe.id,week,linkId).first<{id:number}>())!.id
})
const quantity=async()=> (await env.DB.prepare('SELECT quantity_tenths AS q FROM inventory_items WHERE id=?').bind(itemId).first<{q:number}>())?.q
it('同時同IDのconsume/undoは減算と返却を一度だけ行う',async()=>{
 const consume=input()
 const results=await Promise.all([consumeMenuEntry(env.DB,scope,entryId,consume),consumeMenuEntry(env.DB,scope,entryId,consume)])
 expect(results[0]).toEqual(results[1]);expect(results[0].status).toBe(200);expect(await quantity()).toBe(20)
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(1))).status).toBe(409)
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=quantity_tenths+30 WHERE id=?').bind(itemId).run()
 const undo=input(1)
 const undone=await Promise.all([undoMenuConsumption(env.DB,scope,entryId,undo),undoMenuConsumption(env.DB,scope,entryId,undo)])
 expect(undone[0]).toEqual(undone[1]);expect(undone[0].status).toBe(200);expect(await quantity()).toBe(60)
 expect((await consumeMenuEntry(env.DB,scope,entryId,input(2))).status).toBe(200)
})
it('同じ在庫の別メニュー同時消費は負数を作らず一方だけ成功する',async()=>{
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=10 WHERE id=?').bind(itemId).run()
 const second=(await env.DB.prepare("INSERT INTO menu_entries(household_id,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,'2099-01-05',?,10) RETURNING id").bind(scope.householdId,linkId).first<{id:number}>())!
 // A second active menu may use another recipe/link; the original event is duplicated here without a link's week uniqueness.
 await env.DB.prepare('UPDATE menu_entries SET inventory_menu_link_id=NULL WHERE id=?').bind(second.id).run()
 const recipe=(await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] other') RETURNING id").bind(scope.householdId,scope.actorUserId).first<{id:number}>())!
 const link=(await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on) VALUES(?,?,?,'[E2E_TEST] other',?) RETURNING id").bind(scope.householdId,itemId,recipe.id,currentWeekStart(getJstToday())).first<{id:number}>())!
 await env.DB.prepare('UPDATE menu_entries SET inventory_menu_link_id=?,recipe_id=?,week_start_date=? WHERE id=?').bind(link.id,recipe.id,currentWeekStart(getJstToday()),second.id).run()
 const results=await Promise.all([consumeMenuEntry(env.DB,scope,entryId,input()),consumeMenuEntry(env.DB,scope,second.id,input())])
 expect(results.map(x=>x.status).sort()).toEqual([200,409]);expect(await quantity()).toBe(0)
 expect(await env.DB.prepare('SELECT carry_enabled FROM inventory_menu_links WHERE id=?').bind(linkId).first()).toEqual({carry_enabled:0})
})
it('新規操作の前週未来を拒否、保存再送は行削除後も結果を返す',async()=>{
 const request=input();const result=await consumeMenuEntry(env.DB,scope,entryId,request)
 await env.DB.prepare("UPDATE menu_entries SET week_start_date='2099-01-05' WHERE id=?").bind(entryId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409)
 await env.DB.prepare('DELETE FROM menu_entries WHERE id=?').bind(entryId).run()
 expect(await consumeMenuEntry(env.DB,scope,entryId,request)).toEqual(result)
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(404)
})
it('原本削除後取消可、在庫削除後は取消不可で復活しない',async()=>{
 await consumeMenuEntry(env.DB,scope,entryId,input())
 await env.DB.prepare('DELETE FROM recipes WHERE id=(SELECT recipe_id FROM inventory_menu_links WHERE id=?)').bind(linkId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(200)
 // A consumed event is retained after inventory deletion; a new undo must fail rather than recreate stock.
 await env.DB.prepare("UPDATE menu_entries SET meal_state='eaten',meal_revision=3 WHERE id=?").bind(entryId).run()
 await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(itemId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(3))).status).toBe(409)
 expect(await quantity()).toBeUndefined()
})


it('初回台帳miss後に同要求が成功し週行が削除されても保存成功を優先する',async()=>{
 const request=input()
 let inserted=false
 const racingDb={
  prepare(sql:string){
   const stmt=env.DB.prepare(sql)
   if(sql.startsWith('SELECT e.id,e.week_start_date'))return {
    bind(...values:unknown[]){return {async first(){
     if(!inserted){inserted=true;await consumeMenuEntry(env.DB,scope,entryId,request);await env.DB.prepare('DELETE FROM menu_entries WHERE id=?').bind(entryId).run()}
     return stmt.bind(...values).first()
    }}},
   }
   return stmt
  },
  batch:env.DB.batch.bind(env.DB),
 } as unknown as D1Database
 expect((await consumeMenuEntry(racingDb,scope,entryId,request)).status).toBe(200)
 expect(await quantity()).toBe(20)
})


it('取消上限超過は全rollbackし、他人の同IDでは成功を流用しない',async()=>{
 const consumed=await consumeMenuEntry(env.DB,scope,entryId,input())
 expect(consumed.status).toBe(200)
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=?').bind(itemId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409)
 expect(await quantity()).toBe(999999)
 expect(await env.DB.prepare('SELECT meal_state,meal_revision FROM menu_entries WHERE id=?').bind(entryId).first()).toEqual({meal_state:'eaten',meal_revision:1})
})
it.each(['2020-01-06','2099-01-05'])('新規consumeは当週以外%sを拒否する',async week=>{
 await env.DB.prepare('UPDATE menu_entries SET week_start_date=? WHERE id=?').bind(week,entryId).run()
 expect((await consumeMenuEntry(env.DB,scope,entryId,input())).status).toBe(409)
 expect(await quantity()).toBe(30)
})
it('在庫削除は食事履歴を残して参照だけ外し、取消で復活させない',async()=>{
 await consumeMenuEntry(env.DB,scope,entryId,input())
 await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(itemId).run()
 expect((await undoMenuConsumption(env.DB,scope,entryId,input(1))).status).toBe(409)
 expect(await env.DB.prepare('SELECT inventory_item_id,quantity_tenths,undone_at FROM menu_consumption_events WHERE menu_entry_id=?').bind(entryId).first()).toEqual({inventory_item_id:null,quantity_tenths:10,undone_at:null})
})
