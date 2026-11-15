import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { executeMenuOperation, type MenuScope } from '../../lib/menu-operation-requests'

let scope: MenuScope
beforeEach(async()=>{
 const user=await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_menu') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>()
 const house=await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] ledger',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>()
 scope={actorUserId:user!.id,householdId:house!.id}
})
it('同要求の並行送信は一度だけ書き込み、保存結果を再現する',async()=>{
 const id=crypto.randomUUID()
 const run=()=>executeMenuOperation(env.DB,scope,id,'{"version":1,"operation":"test"}',()=>[
  env.DB.prepare("INSERT INTO stores(household_id,name) VALUES(?,'[E2E_TEST] once')").bind(scope.householdId),
  env.DB.prepare("UPDATE menu_operation_requests SET response_status=200,response_json=? WHERE household_id=? AND actor_user_id=? AND request_id=?").bind('{"ok":true}',scope.householdId,scope.actorUserId,id),
 ])
 const results=await Promise.all([run(),run()])
 expect(results).toEqual([{status:200,body:{ok:true}},{status:200,body:{ok:true}}])
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stores WHERE household_id=?').bind(scope.householdId).first()).toEqual({n:1})
 expect(await executeMenuOperation(env.DB,scope,id,'{"version":1,"operation":"other"}',()=>[])).toMatchObject({status:409})
})
it('応答未確定のbatchは副作用と台帳を全rollbackする',async()=>{
 const id=crypto.randomUUID()
 await expect(executeMenuOperation(env.DB,scope,id,'{}',()=>[env.DB.prepare("INSERT INTO stores(household_id,name) VALUES(?,'[E2E_TEST] rollback')").bind(scope.householdId)])).rejects.toThrow('menu_operation_guard')
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stores WHERE household_id=?').bind(scope.householdId).first()).toEqual({n:0})
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM menu_operation_requests WHERE household_id=?').bind(scope.householdId).first()).toEqual({n:0})
})
