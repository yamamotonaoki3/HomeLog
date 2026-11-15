import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { saveMenuPending, readMenuPending, removeMenuPending, menuPendingKey } from '../../lib/menuOperationPending'
const scope = { actorUserId: 1, householdId: 10 }
const request = { kind: 'consume' as const, entryId: 11, body: { requestId: '12345678-1234-4234-8234-123456789abc', expectedRevision: 2 } }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, cb: () => unknown) => cb() } }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('操作をdeep copyしてscope別保存し別要求で上書きしない', async () => {
 const input = structuredClone(request)
 const saved = await saveMenuPending(scope, () => input, () => true)
 input.body.expectedRevision = 9
 expect(saved.kind).toBe('saved')
 expect(readMenuPending(scope)).toMatchObject({kind:'pending',pending:{...scope,...request,version:1}})
 expect((await saveMenuPending(scope, () => ({...request,entryId:12}), () => true)).kind).toBe('existing')
 expect(readMenuPending({...scope,householdId:20})).toEqual({kind:'empty'})
 expect(localStorage.getItem(menuPendingKey(scope))).not.toContain('Token')
})
it('破損・storage不可・排他不可では上書きせず送信可能にしない', async () => {
 localStorage.setItem(menuPendingKey(scope), '{')
 expect((await saveMenuPending(scope, () => request, () => true)).kind).toBe('blocked')
 expect(localStorage.getItem(menuPendingKey(scope))).toBe('{')
 localStorage.clear(); vi.stubGlobal('navigator', {})
 expect((await saveMenuPending(scope, () => request, () => true)).kind).toBe('blocked')
})
it('一致した保存だけを削除し無効scopeでは残す', async () => {
 const saved = await saveMenuPending(scope, () => request, () => true)
 if(saved.kind !== 'saved' || saved.pending.kind === 'register') throw new Error('not saved')
 expect(await removeMenuPending({...saved.pending,entryId:99}, () => true)).toBe(false)
 expect(await removeMenuPending(saved.pending, () => false)).toBe(false)
 expect(await removeMenuPending(saved.pending, () => true)).toBe(true)
 expect(readMenuPending(scope)).toEqual({kind:'empty'})
})
it('秘密や余分なフィールドを保存しない', async () => {
 const invalid = {...request, body:{...request.body,token:'secret'}}
 expect((await saveMenuPending(scope, () => invalid, () => true)).kind).toBe('blocked')
 expect(readMenuPending(scope)).toEqual({kind:'empty'})
})

it('登録はBEと同じ価格上限までを保持して保存する',async()=>{
 const draft={kind:'register' as const,body:{name:'[E2E_TEST] 在庫',categoryId:1,storeId:null,quantity:0,threshold:0,price:9999999999,autoConsumptionEnabled:false,menuLinkage:{requestId:request.body.requestId,menus:[{newRecipeTitle:'[E2E_TEST] 料理',usageQuantity:1,carryEnabled:false}]}}}
 expect((await saveMenuPending(scope,()=>draft,()=>true)).kind).toBe('saved')
})
