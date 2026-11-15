import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { MenuPage } from '../../pages/MenuPage'
import { setTokens, setAccessToken } from '../../api/tokenStorage'
import { getAccessToken } from '../../api/tokenStorage'
import { apiClient } from '../../api/client'
import { getMondayOf } from '../../lib/week'
const linked = {linkId:5,inventoryItemId:21,inventoryName:'[E2E_TEST] 鶏肉',quantity:3,usageQuantity:1,enabled:true,carryEnabled:false,linkRevision:0,mealState:'uneaten',mealRevision:0,canConsume:true,canUndo:false,unavailableReason:null as null|'recipe_deleted'}
beforeEach(()=>{localStorage.clear();setTokens('testuser_access','testuser_refresh');vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{locks:{request:async(_n:string,_o:unknown,cb:()=>unknown)=>cb()}});server.use(http.get('/api/auth/me',()=>HttpResponse.json({id:1})),http.get('/api/households/me',()=>HttpResponse.json({id:10})))})
afterEach(()=>vi.unstubAllGlobals())
const privateRecipe={id:10,title:'[E2E_TEST] Aのレシピ',ingredients:'[E2E_TEST] Aだけの材料',steps:null,sourceType:'manual',url:null,thumbnailUrl:null,memo:null,isFavorite:false}
it('持ち越しGETのaccess更新後は自動PATCHせず明示確認から新credentialで再操作できる',async()=>{
 const {patches}=setup();let expired=false,refreshes=0
 const patchAuth:(string|null)[]=[]
 server.use(http.get('/api/inventory-items',({request})=>expired&&request.headers.get('Authorization')==='Bearer testuser_access'
  ? HttpResponse.json({code:'UNAUTHORIZED'},{status:401})
  : HttpResponse.json([{id:21,quantity:3,menuLinks:[{id:5,recipeId:10,recipeTitle:'新しい名前',usageQuantity:2,enabled:true,carryEnabled:false,revision:4}]}])),
 http.post('/api/auth/refresh',()=>{refreshes++;return HttpResponse.json({accessToken:'testuser_refreshed_access',expiresIn:3600})}),
 http.patch('/api/inventory-menu-links/5',async({request})=>{const body=await request.json() as {expectedRevision:number;usageQuantity:number;enabled:boolean;carryEnabled:boolean};patches.push(body);patchAuth.push(request.headers.get('Authorization'));return HttpResponse.json({id:5,recipeId:10,recipeTitle:'新しい名前',...body,revision:body.expectedRevision+1})}))
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'来週へ持ち越す'})).toBeEnabled())
 expired=true
 await user.click(screen.getByRole('checkbox',{name:'来週へ持ち越す'}))
 // 固定credential経路なら401で止まるため、明示的な在庫GETでrefreshする。
 await waitFor(()=>expect(refreshes>0||screen.queryByRole('button',{name:'連携設定を再取得'})!==null||screen.queryByRole('button',{name:'本人と世帯を再確認'})!==null).toBe(true))
 if(refreshes===0){
  const retry=screen.queryByRole('button',{name:'連携設定を再取得'})
  if(retry)await user.click(retry)
  else {
   await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
   await user.click(await screen.findByRole('button',{name:'連携設定を再取得'}))
  }
 }
 await waitFor(()=>expect(refreshes).toBe(1))
 await waitFor(()=>expect(getAccessToken()).toBe('testuser_refreshed_access'))
 expect(patches).toHaveLength(0)
 // focusで新credentialを明示確認。隔離された場合は再確認・再取得を行う。
 act(()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(screen.getByRole('button',{name:'次の週'})).toBeEnabled())
 const recheck=screen.queryByRole('button',{name:'本人と世帯を再確認'})
 if(recheck)await user.click(recheck)
 const retry=screen.queryByRole('button',{name:'連携設定を再取得'})
 if(retry)await user.click(retry)
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'来週へ持ち越す'})).toBeEnabled())
 await user.click(screen.getByRole('checkbox',{name:'来週へ持ち越す'}))
 await waitFor(()=>expect(patches).toEqual([{expectedRevision:4,usageQuantity:2,enabled:true,carryEnabled:true}]))
 expect(patchAuth).toEqual(['Bearer testuser_refreshed_access'])
})
function setupOrdinaryMenu(){
 setup()
 const state={accountB:false},posts:unknown[]=[],deletes:string[]=[]
 server.use(http.get('/api/menu-entries',()=>HttpResponse.json([{id:11,recipeId:10,recipeTitle:state.accountB?'[E2E_TEST] Bの献立':'[E2E_TEST] Aの献立',freeTextMemo:null,weekStartDate:getMondayOf(new Date())}])),http.get('/api/recipes',()=>HttpResponse.json(state.accountB?[]:[privateRecipe])),http.post('/api/menu-entries',async({request})=>{posts.push(await request.json());return HttpResponse.json({id:12},{status:201})}),http.delete('/api/menu-entries/11',({request})=>{deletes.push(request.url);return new HttpResponse(null,{status:204})}))
 return {state,posts,deletes}
}
it('初回本人確認中の通常メモは下書きを保持し確認完了後の明示送信だけで追加する',async()=>{
 const {posts}=setupOrdinaryMenu();let release!:()=>void,arrived!:()=>void,authChecks=0
 const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrived=r})
 server.use(http.get('/api/auth/me',async()=>{authChecks++;arrived();await gate;return HttpResponse.json({id:1})}))
 const user=userEvent.setup();render(<MenuPage/>);
 await entered
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 const memo='[E2E_TEST] 初回確認を待つメモ'
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),memo.replace('[','[['))
 await user.click(screen.getByRole('button',{name:'追加'}))
 expect(posts).toHaveLength(0)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toBeEnabled()
 expect(screen.getByRole('button',{name:'本人と世帯を再確認'})).toBeDisabled()
 expect(authChecks).toBe(1)
 await act(async()=>{release()})
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 expect(authChecks).toBe(1)
 expect(posts).toHaveLength(0)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(posts).toEqual([{weekStartDate:getMondayOf(new Date()),freeTextMemo:memo}])
})
it('初回本人確認失敗でも通常メモを保持し再確認後の明示送信だけで追加する',async()=>{
 const {posts}=setupOrdinaryMenu();let unavailable=true
 server.use(http.get('/api/auth/me',()=>unavailable?new HttpResponse(null,{status:503}):HttpResponse.json({id:1})))
 const user=userEvent.setup();render(<MenuPage/>);
 expect(await screen.findByRole('status')).toBeVisible()
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('本人と世帯を確認できません'))
 expect(screen.getByRole('button',{name:'本人と世帯を再確認'})).toBeEnabled()
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 const memo='[E2E_TEST] 再確認後に送るメモ'
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),memo.replace('[','[['))
 await user.click(screen.getByRole('button',{name:'追加'}))
 expect(posts).toHaveLength(0)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toBeEnabled()
 await user.click(screen.getByRole('button',{name:'閉じる'}))
 unavailable=false
 await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 expect(posts).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 expect(posts).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(posts).toEqual([{weekStartDate:getMondayOf(new Date()),freeTextMemo:memo}])
})
it.each(['add','delete'] as const)('確認済みの通常%sは期限切れ401で下書きを保持し明示再確認と再送だけで確定する',async(mode)=>{
 const {posts,deletes}=setupOrdinaryMenu();let expired=false,refreshes=0,authChecks=0
 const households:(string|null)[]=[]
 server.use(http.get('/api/auth/me',({request})=>{
  authChecks++
  return expired&&request.headers.get('Authorization')==='Bearer testuser_access'
   ? HttpResponse.json({code:'UNAUTHORIZED'},{status:401}):HttpResponse.json({id:1})
 }),http.get('/api/households/me',({request})=>{households.push(request.headers.get('Authorization'));return HttpResponse.json({id:10})}),
 http.post('/api/auth/refresh',()=>{refreshes++;return HttpResponse.json({accessToken:'testuser_refreshed_access',expiresIn:3600})}))
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(households).toEqual(['Bearer testuser_access']))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 const memo='[E2E_TEST] 期限切れ後も保持するメモ'
 const open=async()=>{
  if(mode==='add')await user.click(screen.getByRole('button',{name:'レシピを追加'}))
  else {const row=screen.getByRole('button',{name:'[E2E_TEST] Aの献立'});if(row.getAttribute('aria-expanded')!=='true')await user.click(row);await user.click(screen.getByRole('button',{name:'削除'}))}
 }
 const submit=()=>user.click(screen.getByRole('button',{name:mode==='add'?'追加':'献立から削除'}))
 const close=()=>user.click(screen.getByRole('button',{name:mode==='add'?'閉じる':'キャンセル'}))
 const expectDraft=()=>{
  if(mode==='add')expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
  else expect(screen.getByRole('dialog',{name:'献立を削除'})).toHaveTextContent('[E2E_TEST] Aの献立')
 }
 await open()
 if(mode==='add'){
  await user.click(screen.getByRole('radio',{name:'自由メモ'}))
  await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),memo.replace('[','[['))
 }
 expired=true
 await submit()
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('本人と世帯を再確認してください'))
 expectDraft()
 expect(posts).toHaveLength(0);expect(deletes).toHaveLength(0);expect(refreshes).toBe(0)
 expect(authChecks).toBe(2)
 // 古いverifiedScopeが残っていても再送で確認や更新を始めない。
 await submit()
 expectDraft();expect(authChecks).toBe(2)
 expect(posts).toHaveLength(0);expect(deletes).toHaveLength(0);expect(refreshes).toBe(0)
 await close()
 expect(screen.getByRole('status')).toHaveTextContent('下書きは保持されます')
 await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 expect(refreshes).toBe(1)
 expect(households).toEqual(['Bearer testuser_access','Bearer testuser_refreshed_access'])
 expect(posts).toHaveLength(0);expect(deletes).toHaveLength(0)
 await open();expectDraft()
 expect(posts).toHaveLength(0);expect(deletes).toHaveLength(0)
 await submit()
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(refreshes).toBe(1)
 expect(households).toEqual(['Bearer testuser_access','Bearer testuser_refreshed_access','Bearer testuser_refreshed_access'])
 if(mode==='add'){
  expect(posts).toEqual([{weekStartDate:getMondayOf(new Date()),freeTextMemo:memo}]);expect(deletes).toHaveLength(0)
 }else {expect(deletes).toHaveLength(1);expect(posts).toHaveLength(0)}
})
it('確認済み通常メモの503と明示再確認失敗は下書きを保持し新しい確認成功まで再送を止める',async()=>{
 const {posts,deletes}=setupOrdinaryMenu();let unavailable=false,authChecks=0,refreshes=0,householdChecks=0
 server.use(http.get('/api/auth/me',()=>{authChecks++;return unavailable?new HttpResponse(null,{status:503}):HttpResponse.json({id:1})}),
 http.get('/api/households/me',()=>{householdChecks++;return HttpResponse.json({id:10})}),
 http.post('/api/auth/refresh',()=>{refreshes++;return HttpResponse.json({accessToken:'testuser_refreshed_access',expiresIn:3600})}))
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(householdChecks).toBe(1))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 const memo='[E2E_TEST] 確認サーバー復旧を待つメモ'
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),memo.replace('[','[['))
 unavailable=true
 await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('本人と世帯を再確認してください'))
 expect(authChecks).toBe(2)
 await user.click(screen.getByRole('button',{name:'追加'}))
 expect(authChecks).toBe(2);expect(posts).toHaveLength(0)
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 await user.click(screen.getByRole('button',{name:'閉じる'}))
 await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('本人と世帯を確認できません'))
 await waitFor(()=>expect(screen.getByRole('button',{name:'本人と世帯を再確認'})).toBeEnabled())
 expect(authChecks).toBe(3);expect(refreshes).toBe(0)
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 await user.click(screen.getByRole('button',{name:'追加'}))
 expect(authChecks).toBe(3);expect(posts).toHaveLength(0);expect(deletes).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'閉じる'}))
 unavailable=false
 await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})).not.toBeInTheDocument())
 expect(authChecks).toBe(4);expect(householdChecks).toBe(2)
 expect(posts).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue(memo)
 expect(posts).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(posts).toEqual([{weekStartDate:getMondayOf(new Date()),freeTextMemo:memo}])
 expect(deletes).toHaveLength(0);expect(refreshes).toBe(0)
})
it('通常メモ保存の直前に同tokenの世帯変更を検出し旧draftを送信しない',async()=>{
 const {posts}=setupOrdinaryMenu();let household=10
 server.use(http.get('/api/households/me',()=>HttpResponse.json({id:household})))
 const user=userEvent.setup();render(<MenuPage/>);
 await user.click(await screen.findByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),'[E2E_TEST] 旧世帯だけのメモ'.replace('[','[['))
 household=20
 await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(posts).toHaveLength(0)
 expect(screen.getByRole('button',{name:'レシピを追加'})).toBeDisabled()
})
it('同tokenの世帯変更をcarryのscope検証で初検出したら旧一覧と下書きを隔離し明示確認で復帰する',async()=>{
 const {state,patches}=setup()
 let householdId=10
 let armed=false
 let mismatchConfirmed=false,allowRecheck=false
 const verificationGets:string[]=[]
 const checkedHouseholds:number[]=[],memoPosts:unknown[]=[]
 server.use(http.get('/api/inventory-items',()=>{
  const rows=[{id:21,name:'[E2E_TEST] 鶏肉',quantity:state.link.quantity,menuLinks:[{id:5,recipeId:10,recipeTitle:'新しい名前',usageQuantity:2,enabled:true,carryEnabled:false,revision:4}]}]
  if(armed){householdId=20;armed=false}
  return HttpResponse.json(rows)
 }),http.get('/api/auth/me',()=>{
  verificationGets.push('/auth/me')
  return mismatchConfirmed&&!allowRecheck?HttpResponse.error():HttpResponse.json({id:1})
 }),http.get('/api/households/me',()=>{
  verificationGets.push('/households/me');checkedHouseholds.push(householdId)
  if(mismatchConfirmed&&!allowRecheck)return HttpResponse.error()
  if(householdId===20)mismatchConfirmed=true
  return HttpResponse.json({id:householdId})
 }),http.post('/api/menu-entries',async({request})=>{memoPosts.push(await request.json());return HttpResponse.json({id:12},{status:201})}))
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'来週へ持ち越す'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),'[E2E_TEST] 世帯10の未公開メモ'.replace('[','[['))
 expect(checkedHouseholds).toEqual([10])
 // focus/storage/recheckを挟まず、carry専用の固定scope検証に初検出させる。
 armed=true
 await user.click(screen.getByRole('checkbox',{name:'来週へ持ち越す'}))
 await waitFor(()=>expect(checkedHouseholds).toEqual([10,20]))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'本人と世帯を再確認'})||screen.queryByRole('button',{name:'連携設定を再取得'})).not.toBeNull())
 expect(verificationGets).toEqual(['/auth/me','/households/me','/auth/me','/households/me'])
 expect(patches).toHaveLength(0)
 const staleSheet=screen.queryByRole('dialog',{name:'献立に追加する'})
 if(staleSheet)await user.click(within(staleSheet).getByRole('button',{name:'追加'}))
 expect(memoPosts).toHaveLength(0)
 expect(screen.queryByRole('dialog',{name:'献立に追加する'})).not.toBeInTheDocument()
 expect(screen.queryByDisplayValue('[E2E_TEST] 世帯10の未公開メモ')).not.toBeInTheDocument()
 expect(screen.queryByText('[E2E_TEST] 週の名前')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'レシピを追加'})).toBeDisabled()
 expect(checkedHouseholds).toEqual([10,20])
 expect(verificationGets).toEqual(['/auth/me','/households/me','/auth/me','/households/me'])
 state.name='[E2E_TEST] 世帯20の献立'
 allowRecheck=true
 await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 expect(await screen.findByText('[E2E_TEST] 世帯20の献立')).toBeVisible()
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 expect(checkedHouseholds.at(-1)).toBe(20)
 await user.click(screen.getByRole('button',{name:'レシピを追加'}));await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue('')
 expect(memoPosts).toHaveLength(0)
 expect(patches).toHaveLength(0)
})
async function detachPage(){
 act(()=>{setTokens('testuser_b_access','testuser_b_refresh');window.dispatchEvent(new Event('storage'))})
 await waitFor(()=>expect(screen.getByRole('button',{name:'本人と世帯を再確認'})).toBeEnabled())
}
it.each(['add','delete'] as const)('通常%s送信中の同session access更新でもbusyを残さず再確認できる',async(mode)=>{
 setupOrdinaryMenu();let release!:()=>void,arrived!:()=>void
 const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrived=r})
 const late=async()=>{arrived();await gate;return mode==='add'?HttpResponse.json({id:12},{status:201}):new HttpResponse(null,{status:204})}
 server.use(mode==='add'?http.post('/api/menu-entries',late):http.delete('/api/menu-entries/11',late))
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 if(mode==='add'){
  await user.click(screen.getByRole('button',{name:'レシピを追加'}));await user.click(screen.getByRole('radio',{name:'自由メモ'}))
  await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),'[E2E_TEST] refresh中のメモ'.replace('[','[['));await user.click(screen.getByRole('button',{name:'追加'}))
 }else{
  await user.click(screen.getByRole('button',{name:'[E2E_TEST] Aの献立'}));await user.click(screen.getByRole('button',{name:'削除'}));await user.click(screen.getByRole('button',{name:'献立から削除'}))
 }
 await entered
 act(()=>{setAccessToken('testuser_refreshed_access');release()})
 const recheck=await screen.findByRole('button',{name:'本人と世帯を再確認'})
 await waitFor(()=>expect(recheck).toBeEnabled())
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 await user.click(recheck)
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
})
it('Aの未保存メモと選択をtoken切替で破棄し旧sheetから追加させない',async()=>{
 const {state,posts}=setupOrdinaryMenu();const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}))
 await user.click(screen.getByRole('checkbox',{name:privateRecipe.title}))
 await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),'[E2E_TEST] Aの未公開メモ'.replace('[','[['))
 await detachPage()
 const staleSheet=screen.queryByRole('dialog',{name:'献立に追加する'})
 if(staleSheet)await user.click(within(staleSheet).getByRole('button',{name:'追加'}))
 expect(posts).toHaveLength(0)
 expect(screen.queryByRole('dialog',{name:'献立に追加する'})).not.toBeInTheDocument()
 expect(screen.queryByDisplayValue('[E2E_TEST] Aの未公開メモ')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'レシピを追加'})).toBeDisabled()
 state.accountB=true;await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'レシピを追加'}));await user.click(screen.getByRole('radio',{name:'自由メモ'}))
 expect(screen.getByRole('textbox',{name:'自由メモの内容'})).toHaveValue('')
 await user.click(screen.getByRole('radio',{name:'レシピから選ぶ'}))
 expect(screen.getByText('選択中: 0件（検索外の選択を含む）')).toBeVisible()
 expect(posts).toHaveLength(0)
})
it.each(['detail','delete'] as const)('token切替でAの%sダイアログを隔離し旧献立を削除させない',async(mode)=>{
 const {deletes}=setupOrdinaryMenu();const user=userEvent.setup();render(<MenuPage/>);
 await user.click(await screen.findByRole('button',{name:'[E2E_TEST] Aの献立'}))
 await user.click(await screen.findByRole('button',{name:mode==='detail'?'レシピを見る':'削除'}))
 expect(screen.getByRole('dialog',{name:mode==='detail'?'レシピ詳細':'献立を削除'})).toBeVisible()
 await detachPage()
 const staleDelete=screen.queryByRole('button',{name:'献立から削除'})
 if(staleDelete)await user.click(staleDelete)
 expect(deletes).toHaveLength(0)
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 expect(screen.queryByText(privateRecipe.ingredients)).not.toBeInTheDocument()
 expect(screen.queryByText('[E2E_TEST] Aの献立')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'レシピを追加'})).toBeDisabled()
})
it.each(['add','delete'] as const)('通常%sの後着失敗は切替後のmodalへ旧errorを復活させない',async(mode)=>{
 const {state}=setupOrdinaryMenu();let arrived!:()=>void,release!:()=>void
 const entered=new Promise<void>(r=>{arrived=r}),gate=new Promise<void>(r=>{release=r})
 const late=async()=>{arrived();await gate;return HttpResponse.json({code:'VALIDATION_ERROR',message:'[E2E_TEST] Aの後着エラー'},{status:400})}
 server.use(mode==='add'?http.post('/api/menu-entries',late):http.delete('/api/menu-entries/11',late))
 const mutation=vi.spyOn(apiClient,mode==='add'?'post':'delete')
 const user=userEvent.setup();render(<MenuPage/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
 if(mode==='add'){
  await user.click(screen.getByRole('button',{name:'レシピを追加'}));await user.click(screen.getByRole('radio',{name:'自由メモ'}));await user.type(screen.getByRole('textbox',{name:'自由メモの内容'}),'[E2E_TEST] Aの送信メモ'.replace('[','[['));await user.click(screen.getByRole('button',{name:'追加'}))
 }else{
  await user.click(screen.getByRole('button',{name:'[E2E_TEST] Aの献立'}));await user.click(screen.getByRole('button',{name:'削除'}));await user.click(screen.getByRole('button',{name:'献立から削除'}))
 }
 await entered
 const response=mutation.mock.results[0].value as Promise<unknown>
 mutation.mockRestore()
 try{
  await detachPage()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  state.accountB=true;await user.click(screen.getByRole('button',{name:'本人と世帯を再確認'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'レシピを追加'})).toBeEnabled())
  if(mode==='add')await user.click(screen.getByRole('button',{name:'レシピを追加'}))
  else {await user.click(await screen.findByRole('button',{name:'[E2E_TEST] Bの献立'}));await user.click(screen.getByRole('button',{name:'削除'}))}
 }finally{await act(async()=>{release();await response.catch(()=>{})})}
 await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('button',{name:mode==='add'?'追加':'献立から削除'})).toBeEnabled())
 expect(screen.queryByText('[E2E_TEST] Aの後着エラー')).not.toBeInTheDocument()
 expect(screen.queryByText('[E2E_TEST] Aの献立')).not.toBeInTheDocument()
 expect(screen.queryByDisplayValue('[E2E_TEST] Aの送信メモ')).not.toBeInTheDocument()
})
function setup(){
 const state={link:{...linked},name:'[E2E_TEST] 週の名前',recipeId:10 as number|null,inventoryFail:false}; const posts:unknown[]=[];const patches:unknown[]=[]
 server.use(http.get('/api/menu-entries',()=>HttpResponse.json([{id:11,recipeId:state.recipeId,recipeTitle:state.name,freeTextMemo:null,weekStartDate:getMondayOf(new Date()),inventoryLinkage:state.link}])),http.get('/api/recipes',()=>HttpResponse.json([])),http.get('/api/inventory-items',()=>state.inventoryFail?new HttpResponse(null,{status:503}):HttpResponse.json([{id:21,name:'[E2E_TEST] 鶏肉',quantity:state.link.quantity,menuLinks:[{id:5,recipeId:10,recipeTitle:'新しい名前',usageQuantity:2,enabled:true,carryEnabled:false,revision:4}]}])),http.post('/api/menu-entries/11/consume',async({request})=>{posts.push(await request.json());state.link={...state.link,mealState:'eaten',mealRevision:1,quantity:2,canConsume:false,canUndo:true};return HttpResponse.json({menuEntryId:11,mealState:'eaten',mealRevision:1,inventoryItemId:21,quantity:2,carryEnabled:false})}),http.post('/api/menu-entries/11/undo-consumption',async({request})=>{posts.push(await request.json());state.link={...state.link,mealState:'uneaten',mealRevision:2,quantity:3,canConsume:true,canUndo:false};return HttpResponse.json({menuEntryId:11,mealState:'uneaten',mealRevision:2,inventoryItemId:21,quantity:3,carryEnabled:false})}),http.patch('/api/inventory-menu-links/5',async({request})=>{const body=await request.json() as {usageQuantity:number;expectedRevision:number;carryEnabled:boolean};patches.push(body);return HttpResponse.json({id:5,recipeId:10,recipeTitle:'新しい名前',usageQuantity:body.usageQuantity,enabled:true,carryEnabled:body.carryEnabled,revision:body.expectedRevision+1})}))
 return {state,posts,patches}
}
it('回数がnullの連携行は詳細を開いて操作し、0回を表示しない',async()=>{
 setup()
 server.use(http.get('/api/menu-entries',()=>HttpResponse.json([{id:11,recipeId:10,recipeTitle:'[E2E_TEST] 過去の献立',freeTextMemo:null,weekStartDate:getMondayOf(new Date()),inventoryLinkage:{...linked,remainingCount:null}}])))
 const user=userEvent.setup();render(<MenuPage/>)
 const title=await screen.findByRole('button',{name:'[E2E_TEST] 過去の献立'})
 expect(title).not.toHaveTextContent('×0')
 expect(screen.queryByRole('button',{name:'食べた'})).not.toBeInTheDocument()
 await user.click(title)
 expect(screen.getByRole('button',{name:'食べた'})).toBeVisible()
})
it('食事確認後だけ1個減算し取消で返し、週名を保つ',async()=>{
 const {posts}=setup();const user=userEvent.setup();render(<MenuPage/>);
 await user.click(await screen.findByRole('button',{name:'食べた'}));expect(posts).toHaveLength(0)
 const dialog=screen.getByRole('dialog',{name:'食事を記録'});expect(dialog).toHaveTextContent('1');await user.click(within(dialog).getByRole('button',{name:'食べたことを記録'}))
 await user.click(await screen.findByRole('button',{name:'取り消す'}));await user.click(within(screen.getByRole('dialog',{name:'食事を取り消す'})).getByRole('button',{name:'食事を取り消して戻す'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'食べた'})).toBeEnabled());expect(posts).toHaveLength(2);expect(screen.getByText('[E2E_TEST] 週の名前')).toBeVisible()
})
it('持ち越しPATCHには週行の古い使用数でなく最新link値とrevisionを送る',async()=>{
 const {patches}=setup();const user=userEvent.setup();render(<MenuPage/>);const toggle=await screen.findByRole('checkbox',{name:'来週へ持ち越す'});await waitFor(()=>expect(toggle).toBeEnabled());await user.click(toggle)
 await waitFor(()=>expect(patches).toEqual([{expectedRevision:4,usageQuantity:2,enabled:true,carryEnabled:true}]))
})
it('原本削除後もsnapshot名と取消を示し、在庫GET失敗は取消を止めない',async()=>{
 const {state}=setup();state.recipeId=null;state.inventoryFail=true;state.link={...state.link,mealState:'eaten',mealRevision:1,canConsume:false,canUndo:true,unavailableReason:'recipe_deleted'};render(<MenuPage/>);
 expect(await screen.findByText('[E2E_TEST] 週の名前')).toBeVisible();await waitFor(()=>expect(screen.getByRole('button',{name:'取り消す'})).toBeEnabled());expect(screen.queryByRole('button',{name:'レシピを見る'})).not.toBeInTheDocument();expect(screen.getByRole('checkbox',{name:'来週へ持ち越す'})).toBeDisabled()
})

it('結果不明では再確定と連携行削除を止め同じ内容の確認だけを示す',async()=>{
 setup();server.use(http.post('/api/menu-entries/11/consume',()=>HttpResponse.error()));const user=userEvent.setup();render(<MenuPage/>);
 await user.click(await screen.findByRole('button',{name:'[E2E_TEST] 週の名前'}));await user.click(screen.getByRole('button',{name:'食べた'}));await user.click(screen.getByRole('button',{name:'食べたことを記録'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('結果を確認できません。同じ内容で確認してください'))
 expect(screen.getByRole('button',{name:'食べたことを記録'})).toBeDisabled();await user.click(screen.getByRole('button',{name:'キャンセル'}));expect(screen.getByRole('button',{name:'削除'})).toBeDisabled();expect(screen.getByRole('button',{name:'前回の結果を確認'})).toBeEnabled()
})

it('認証失効で一覧を隔離した後も本人再確認から新しいGETで再開できる',async()=>{
 setup();let arrived!:()=>void,release!:()=>void
 const entered=new Promise<void>(r=>{arrived=r}),gate=new Promise<void>(r=>{release=r})
 server.use(http.post('/api/menu-entries/11/consume',async()=>{arrived();await gate;return HttpResponse.json({menuEntryId:11,mealState:'eaten',mealRevision:1,inventoryItemId:21,quantity:2,carryEnabled:false})}))
 const user=userEvent.setup();render(<MenuPage/>);await user.click(await screen.findByRole('button',{name:'食べた'}));await user.click(screen.getByRole('button',{name:'食べたことを記録'}));await entered
 setTokens('testuser_new_access','testuser_new_refresh');release()
 const recheck=await screen.findByRole('button',{name:'本人と世帯を再確認'});expect(screen.queryByText('[E2E_TEST] 週の名前')).not.toBeInTheDocument();await user.click(recheck)
 expect(await screen.findByText('[E2E_TEST] 週の名前')).toBeVisible()
})
