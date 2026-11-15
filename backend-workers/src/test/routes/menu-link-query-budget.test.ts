import { env } from 'cloudflare:test'
import { beforeEach,expect,it } from 'vitest'
import app from '../../index'
import {signAccessToken} from '../../lib/jwt'
import {currentWeekStart,getJstToday} from '../../lib/date'

let householdId:number,categoryId:number,headers:Record<string,string>
beforeEach(async()=>{
 const user=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_budget') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 householdId=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] budget',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!.id
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(householdId,user.id).run()
 categoryId=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food') RETURNING id").bind(householdId).first<{id:number}>())!.id
 headers={Authorization:'Bearer '+await signAccessToken(user.id,env.JWT_SECRET,900)}
})
async function measuredGet(path:string){
 let queries=0
 const db={
  prepare(sql:string){queries++;return env.DB.prepare(sql)},
  batch:env.DB.batch.bind(env.DB),
 } as unknown as D1Database
 const response=await app.request('/api/'+path,{headers},{...env,DB:db})
 return {response,queries}
}
it('通常在庫60件も世帯内関連を一括取得して4query以内で返す',async()=>{
 const values=Array.from({length:60},(_,i)=>"(?1,'[E2E_TEST] stock "+i+"',?2,30,10)").join(',')
 await env.DB.prepare('INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES '+values).bind(householdId,categoryId).run()
 const {response,queries}=await measuredGet('inventory-items')
 expect(response.status).toBe(200)
 const rows=await response.json<{menuLinks:unknown[]}[]>()
 expect(rows).toHaveLength(60);expect(rows.every(row=>row.menuLinks.length===0)).toBe(true)
 expect(queries).toBeLessThanOrEqual(4)
})
it('通常自由メモ60件も対象週の関連を一括取得して4query以内で返す',async()=>{
 const week=currentWeekStart(getJstToday())
 const values=Array.from({length:60},(_,i)=>"(?1,'[E2E_TEST] memo "+i+"',?2)").join(',')
 await env.DB.prepare('INSERT INTO menu_entries(household_id,free_text_memo,week_start_date) VALUES '+values).bind(householdId,week).run()
 const {response,queries}=await measuredGet('menu-entries?weekStartDate='+week)
 expect(response.status).toBe(200)
 const rows=await response.json<{inventoryLinkage:unknown}[]>()
 expect(rows).toHaveLength(60);expect(rows.every(row=>row.inventoryLinkage===null)).toBe(true)
 expect(queries).toBeLessThanOrEqual(4)
})


it('一括取得は関連順・削除原本snapshot・無関連・世帯と週の分離を保持する',async()=>{
 const user=(await env.DB.prepare('SELECT user_id FROM household_members WHERE household_id=?').bind(householdId).first<{user_id:number}>())!
 const stock=async(home:number,cat:number,name:string)=>(await env.DB.prepare('INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(?,?,?,30,10) RETURNING id').bind(home,name,cat).first<{id:number}>())!.id
 const recipe=async(home:number,title:string)=>(await env.DB.prepare('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,?) RETURNING id').bind(home,user.user_id,title).first<{id:number}>())!.id
 const first=await stock(householdId,categoryId,'[E2E_TEST] linked')
 const plain=await stock(householdId,categoryId,'[E2E_TEST] plain')
 const recipeA=await recipe(householdId,'[E2E_TEST] current')
 const recipeB=await recipe(householdId,'[E2E_TEST] deleted')
 const week=currentWeekStart(getJstToday())
 const link=async(home:number,item:number,recipeId:number,title:string)=>(await env.DB.prepare('INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on) VALUES(?,?,?,?,?) RETURNING id').bind(home,item,recipeId,title,week).first<{id:number}>())!.id
 const linkA=await link(householdId,first,recipeA,'[E2E_TEST] current')
 const linkB=await link(householdId,first,recipeB,'[E2E_TEST] deleted')
 const addMenu=async(recipeId:number|null,linkId:number|null,targetWeek:string)=>(await env.DB.prepare('INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,?,?,?,?) RETURNING id').bind(householdId,recipeId,targetWeek,linkId,linkId===null?null:10).first<{id:number}>())!.id
 const menuA=await addMenu(recipeA,linkA,week),menuB=await addMenu(recipeB,linkB,week),normal=await addMenu(null,null,week)
 await addMenu(recipeA,linkA,'2020-01-06')
 const otherHome=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] hidden',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!.id
 const otherCat=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] hidden') RETURNING id").bind(otherHome).first<{id:number}>())!.id
 const otherStock=await stock(otherHome,otherCat,'[E2E_TEST] hidden')
 await link(otherHome,otherStock,await recipe(otherHome,'[E2E_TEST] hidden'),'[E2E_TEST] hidden')
 await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipeB).run()
 const inventory=await measuredGet('inventory-items')
 const inventories=await inventory.response.json<{id:number;menuLinks:{id:number;recipeId:number|null;recipeTitle:string;enabled:boolean}[]}[]>()
 expect(inventories).toHaveLength(2)
 expect(inventories.find(row=>row.id===first)!.menuLinks.map(row=>row.id)).toEqual([linkA,linkB])
 expect(inventories.find(row=>row.id===first)!.menuLinks[1]).toMatchObject({recipeId:null,recipeTitle:'[E2E_TEST] deleted',enabled:false})
 expect(inventories.find(row=>row.id===plain)!.menuLinks).toEqual([])
 expect(inventory.queries).toBeLessThanOrEqual(4)
 const menu=await measuredGet('menu-entries?weekStartDate='+week)
 const entries=await menu.response.json<{id:number;inventoryLinkage:null|{canConsume:boolean;unavailableReason:string|null}}[]>()
 expect(entries.map(row=>row.id)).toEqual([menuA,menuB,normal])
 expect(entries.find(row=>row.id===menuA)!.inventoryLinkage).toMatchObject({canConsume:true,unavailableReason:null})
 expect(entries.find(row=>row.id===menuB)!.inventoryLinkage).toMatchObject({canConsume:false,unavailableReason:'recipe_deleted'})
 expect(entries.find(row=>row.id===normal)!.inventoryLinkage).toBeNull()
 expect(menu.queries).toBeLessThanOrEqual(4)
})
