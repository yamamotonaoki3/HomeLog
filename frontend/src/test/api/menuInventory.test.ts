import { beforeEach, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { setTokens } from '../../api/tokenStorage'
import { captureMenuCredentials, menuMutationOutcome, updateInventoryMenuLink } from '../../api/menuInventory'
import type { MenuRequest } from '../../lib/menuOperationPending'
const request = {kind:'consume' as const,entryId:11,body:{requestId:'12345678-1234-4234-8234-123456789abc',expectedRevision:2}}
beforeEach(()=>setTokens('testuser_access','testuser_refresh'))
it('成功bodyの対象・revision・状態が合わない応答は未知にする',()=>{
 const data = {menuEntryId:11,mealState:'eaten',mealRevision:3,inventoryItemId:21,quantity:2,carryEnabled:false}
 expect(menuMutationOutcome(200,data,request,false).kind).toBe('success')
 for(const bad of [{...data,menuEntryId:12},{...data,mealRevision:2},{...data,mealState:'uneaten'},{...data,quantity:-1}]) expect(menuMutationOutcome(200,bad,request,false).kind).toBe('unknown')
})
it('初回の明確な拒否だけを確定し未知結果後の拒否とmismatchは保存を維持する',()=>{
 expect(menuMutationOutcome(409,{code:'RESOURCE_CONFLICT',message:'競合'},request,false).kind).toBe('rejected')
 expect(menuMutationOutcome(409,{code:'RESOURCE_CONFLICT'},request,true).kind).toBe('unknown')
 expect(menuMutationOutcome(409,{code:'RESOURCE_CONFLICT',message:'同じ操作要求IDで内容が変更されています',details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]},request,false).kind).toBe('unknown')
 expect(menuMutationOutcome(401,{},request,false).kind).toBe('unknown')
})
const operationRequests: MenuRequest[] = [
 {kind:'register',body:{name:'[E2E_TEST] 食材',categoryId:1,storeId:null,quantity:2,threshold:1,menuLinkage:{requestId:request.body.requestId,menus:[{recipeId:3,usageQuantity:1,carryEnabled:false}]}}},
 request,
 {...request,kind:'undo'},
]
it.each(operationRequests)('$kindの実BE形式のmismatchは初回・回復とも未知にする',operation=>{
 const data={code:'RESOURCE_CONFLICT',message:'同じ操作要求IDで内容が変更されています',details:[{field:'quantity',reason:'OTHER'},{field:'requestId',reason:'PAYLOAD_MISMATCH'}]}
 expect(menuMutationOutcome(409,data,operation,false).kind).toBe('unknown')
 expect(menuMutationOutcome(409,data,operation,true).kind).toBe('unknown')
})
it.each(operationRequests)('$kindの通常競合や別field・別reasonは初回確定拒否のままにする',operation=>{
 for(const details of [undefined,[],[{field:'quantity',reason:'PAYLOAD_MISMATCH'}],[{field:'requestId',reason:'OTHER'}],[{field:'requestId',reason:'OTHER'},{field:'quantity',reason:'PAYLOAD_MISMATCH'}]]) {
  const data={code:'RESOURCE_CONFLICT',message:'競合',...(details===undefined?{}:{details})}
  expect(menuMutationOutcome(409,data,operation,false)).toEqual({kind:'rejected',message:'競合'})
 }
})
it('linkPATCH前に本人と世帯を固定credentialで確認し別世帯なら送らない',async()=>{
 let patches=0
 server.use(http.get('/api/auth/me',()=>HttpResponse.json({id:1})),http.get('/api/households/me',()=>HttpResponse.json({id:20})),http.patch('/api/inventory-menu-links/5',()=>{patches++;return HttpResponse.json({})}))
 await expect(updateInventoryMenuLink(5,{expectedRevision:0,usageQuantity:1,enabled:true,carryEnabled:true},{actorUserId:1,householdId:10},captureMenuCredentials()!,()=>true)).rejects.toThrow()
 expect(patches).toBe(0)
})
