import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { setTokens } from '../../api/tokenStorage'
import { useMenuInventoryOperation } from '../../hooks/useMenuInventoryOperation'
import { readMenuPending } from '../../lib/menuOperationPending'
const scope={actorUserId:1,householdId:10}
const input={kind:'consume' as const,entryId:11,mealRevision:2}
const success={menuEntryId:11,mealState:'eaten',mealRevision:3,inventoryItemId:21,quantity:2,carryEnabled:false}
beforeEach(()=>{localStorage.clear();setTokens('testuser_access','testuser_refresh');vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{locks:{request:async(_n:string,_o:unknown,cb:()=>unknown)=>cb()}});server.use(http.get('/api/auth/me',()=>HttpResponse.json({id:1})),http.get('/api/households/me',()=>HttpResponse.json({id:10})))})
afterEach(()=>vi.unstubAllGlobals())
it('同じtokenでもfocusで世帯変更を検出したら隔離し明示再確認で新世帯へ復帰する',async()=>{
 let householdId=10
 const onDetached=vi.fn()
 server.use(http.get('/api/households/me',()=>HttpResponse.json({id:householdId})))
 const {result}=renderHook(()=>useMenuInventoryOperation({actorUserId:1,onDetached}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 householdId=20
 act(()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(result.current.outcome?.kind).toBe('detached'))
 expect(onDetached).toHaveBeenCalledTimes(1)
 expect(result.current.verifiedScope).toBeNull()
 expect(result.current.pending).toBeNull()
 expect(result.current.busy).toBe(false)
 await act(async()=>{await result.current.recheck()})
 expect(result.current.verifiedScope).toEqual({actorUserId:1,householdId:20})
 expect(result.current.outcome).toBeNull()
 expect(onDetached).toHaveBeenCalledTimes(1)
})
it.each(['actor','household'] as const)('回復時の%s不一致はdetachedにして旧pendingを送信も削除もしない',async(mismatch)=>{
 let actorId=1,householdId=10
 const onDetached=vi.fn(),bodies:unknown[]=[]
 server.use(http.get('/api/auth/me',()=>HttpResponse.json({id:actorId})),http.get('/api/households/me',()=>HttpResponse.json({id:householdId})),http.post('/api/menu-entries/11/consume',async({request})=>{bodies.push(await request.json());return HttpResponse.error()}))
 const {result}=renderHook(()=>useMenuInventoryOperation({onDetached}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 await act(async()=>{await result.current.run(input)})
 const original=readMenuPending(scope)
 expect(original.kind).toBe('pending')
 if(mismatch==='actor')actorId=2
 else householdId=20
 await act(async()=>{expect((await result.current.recover()).kind).toBe('detached')})
 expect(result.current.outcome?.kind).toBe('detached')
 expect(result.current.verifiedScope).toBeNull()
 expect(result.current.pending).toBeNull()
 expect(onDetached).toHaveBeenCalledTimes(1)
 expect(bodies).toHaveLength(1)
 expect(readMenuPending(scope)).toEqual(original)
 expect(readMenuPending({actorUserId:actorId,householdId}).kind).toBe('empty')
 await act(async()=>{await result.current.recheck()})
 expect(result.current.verifiedScope).toEqual({actorUserId:actorId,householdId})
 await act(async()=>{await result.current.recover()})
 expect(bodies).toHaveLength(1)
 expect(readMenuPending(scope)).toEqual(original)
})
it.each(['recheck','recover'] as const)('%sの通信失敗は本人不一致扱いせずblockedにする',async(method)=>{
 const onDetached=vi.fn(),bodies:unknown[]=[]
 server.use(http.post('/api/menu-entries/11/consume',async({request})=>{bodies.push(await request.json());return HttpResponse.error()}))
 const {result}=renderHook(()=>useMenuInventoryOperation({actorUserId:1,onDetached}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 await act(async()=>{await result.current.run(input)})
 const original=readMenuPending(scope)
 server.use(http.get('/api/households/me',()=>HttpResponse.error()))
 await act(async()=>{await result.current[method]()})
 expect(result.current.outcome?.kind).toBe('blocked')
 expect(onDetached).not.toHaveBeenCalled()
 expect(readMenuPending(scope)).toEqual(original)
 expect(bodies).toHaveLength(1)
 server.use(http.get('/api/households/me',()=>HttpResponse.json({id:10})))
 await act(async()=>{await result.current.recheck()})
 expect(result.current.verifiedScope).toEqual(scope)
 expect(result.current.pending).toEqual(original.kind==='pending'?original.pending:undefined)
})
it('初回mismatchでも元envelopeを保持し別runを送信せず明示回復だけ同ID/bodyを送る',async()=>{
 const bodies:unknown[]=[]
 let original:ReturnType<typeof readMenuPending>|undefined
 server.use(http.post('/api/menu-entries/:id/consume',async({request})=>{
  bodies.push(await request.json())
  if(bodies.length===1) original=readMenuPending(scope)
  return HttpResponse.json({code:'RESOURCE_CONFLICT',message:'同じ操作要求IDで内容が変更されています',details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]},{status:409})
 }))
 const {result}=renderHook(()=>useMenuInventoryOperation({actorUserId:1}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 await act(async()=>{await result.current.run(input)})
 expect(result.current.outcome?.kind).toBe('unknown')
 expect(original).toEqual({kind:'pending',pending:expect.objectContaining({kind:'consume',entryId:11,...scope,version:1,createdAt:expect.any(String),body:{requestId:expect.any(String),expectedRevision:2}})})
 expect(readMenuPending(scope)).toEqual(original)
 expect(result.current.pending).toEqual(original?.kind==='pending'?original.pending:undefined)
 expect(bodies).toEqual([original?.kind==='pending'?original.pending.body:undefined])
 await act(async()=>{expect((await result.current.run({...input,entryId:12,mealRevision:7})).kind).toBe('blocked')})
 expect(bodies).toHaveLength(1)
 expect(readMenuPending(scope)).toEqual(original)
 expect(result.current.pending).toEqual(original?.kind==='pending'?original.pending:undefined)
 await act(async()=>{await result.current.recover()})
 expect(bodies).toHaveLength(2)
 expect(bodies[1]).toEqual(bodies[0])
 expect(result.current.outcome?.kind).toBe('unknown')
 expect(readMenuPending(scope)).toEqual(original)
 expect(result.current.pending).toEqual(original?.kind==='pending'?original.pending:undefined)
})
it('応答不明を保存し同ID/bodyで回復、回復409後も保持し成功で解決する',async()=>{
 const bodies:unknown[]=[]
 server.use(http.post('/api/menu-entries/11/consume',async({request})=>{bodies.push(await request.json());return bodies.length===1?HttpResponse.error():bodies.length===2?HttpResponse.json({code:'RESOURCE_CONFLICT'},{status:409}):HttpResponse.json(success)}))
 const {result}=renderHook(()=>useMenuInventoryOperation({actorUserId:1}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 await act(async()=>{await result.current.run(input)})
 expect(result.current.outcome?.kind).toBe('unknown');expect(readMenuPending(scope).kind).toBe('pending')
 await act(async()=>{await result.current.run({...input,entryId:12});await result.current.recover()})
 expect(bodies).toHaveLength(2);expect(result.current.outcome?.kind).toBe('unknown');expect(readMenuPending(scope).kind).toBe('pending')
 await act(async()=>{await result.current.recover()})
 expect(bodies[0]).toEqual(bodies[1]);expect(bodies[1]).toEqual(bodies[2]);expect(result.current.outcome?.kind).toBe('success');expect(readMenuPending(scope).kind).toBe('empty')
})
it('初回確定拒否は解決し別操作を許す',async()=>{
 server.use(http.post('/api/menu-entries/11/consume',()=>HttpResponse.json({code:'RESOURCE_CONFLICT',message:'競合'},{status:409})))
 const {result}=renderHook(()=>useMenuInventoryOperation({actorUserId:1}))
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 await act(async()=>{await result.current.run(input)})
 expect(result.current.outcome?.kind).toBe('rejected');expect(readMenuPending(scope).kind).toBe('empty')
})
it('送信中にidentity変更した旧応答を適用せず元scope操作を残す',async()=>{
 let arrived!:()=>void,release!:()=>void
 const entered=new Promise<void>(r=>{arrived=r}),gate=new Promise<void>(r=>{release=r})
 server.use(http.post('/api/menu-entries/11/consume',async()=>{arrived();await gate;return HttpResponse.json(success)}))
 const {result,rerender}=renderHook(({actor})=>useMenuInventoryOperation({actorUserId:actor}),{initialProps:{actor:1}})
 await waitFor(()=>expect(result.current.verifiedScope).toEqual(scope))
 let sending!:Promise<unknown>
 act(()=>{sending=result.current.run(input)})
 await entered
 await act(async()=>{setTokens('testuser_b_access','testuser_b_refresh');rerender({actor:2});release();await sending})
 expect(result.current.outcome?.kind).not.toBe('success');expect(readMenuPending(scope).kind).toBe('pending');expect(result.current.pending).toBeNull()
})
it('同scopeの別mountは排他保存で別要求を送信しない',async()=>{
 let entered!:()=>void,release!:()=>void,posts=0
 const arrived=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
 server.use(http.post('/api/menu-entries/11/consume',async()=>{posts++;entered();await gate;return HttpResponse.json(success)}))
 const a=renderHook(()=>useMenuInventoryOperation({actorUserId:1})),b=renderHook(()=>useMenuInventoryOperation({actorUserId:1}))
 await waitFor(()=>expect(a.result.current.verifiedScope).toEqual(scope));await waitFor(()=>expect(b.result.current.verifiedScope).toEqual(scope))
 let sending!:Promise<unknown>;act(()=>{sending=a.result.current.run(input)})
 await arrived
 await act(async()=>{await b.result.current.run(input)})
 expect(posts).toBe(1);expect(b.result.current.pending).not.toBeNull()
 await act(async()=>{release();await sending})
 expect(readMenuPending(scope).kind).toBe('empty')
})
