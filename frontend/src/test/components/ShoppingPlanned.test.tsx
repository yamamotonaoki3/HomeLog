import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'
import { setTokens, clearTokens } from '../../api/tokenStorage'
const inventory = [1,2].map(id => ({ id, name: 'testuser_品目'+id, categoryId: 1, storeId: id === 1 ? 1 : null, quantity: 0.5, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }))
const shopping = inventory.map(i => ({ id: i.id+10, inventoryItemId: i.id, name: i.name, isManual: true, purchased: false, purchasedQuantity: 0, plannedQuantity: 3, purchaseRevision: 2, price: null }))
const props = { shopping, inventory, categories: [{ id: 1, name: '食品', isDefault: true }], stores: [{ id: 1, name: '店舗A' }], sort: 'store' as const, onSortChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn(), actorUserId: 1 }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
it('予定3を明示保存してcleanになった後の最新GET5を詳細と次PATCHの値とrevisionに使う', async () => {
  const user = userEvent.setup(), bodies: unknown[] = []
  server.use(http.patch('/api/shopping-list-items/11', async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json(bodies.length === 1 ? { id: 11, plannedQuantity: 3, purchaseRevision: 3 } : { id: 11, plannedQuantity: 5, purchaseRevision: 5 })
  }))
  const { rerender } = render(<ShoppingListPanel {...props} />)
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細' }))
  await user.click(screen.getByRole('button', { name: '予定数を保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '予定数を保存' })).toBeEnabled())
  expect(bodies).toEqual([{ plannedQuantity: 3, expectedPurchaseRevision: 2 }])
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })).toHaveValue('3')
  rerender(<ShoppingListPanel {...props} shopping={[{ ...shopping[0], plannedQuantity: 5, purchaseRevision: 4 }, shopping[1]]} />)
  expect(screen.getByRole('button', { name: 'testuser_品目1の詳細' })).toHaveTextContent('予定 5')
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })).toHaveValue('5')
  await user.click(screen.getByRole('button', { name: '予定数を保存' }))
  await waitFor(() => expect(bodies).toEqual([
    { plannedQuantity: 3, expectedPurchaseRevision: 2 },
    { plannedQuantity: 5, expectedPurchaseRevision: 4 },
  ]))
  await waitFor(() => expect(screen.getByRole('button', { name: '予定数を保存' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })).toHaveValue('5')
})
it('通常PATCHのaccess更新後もチェックと実数とdirty予定を保持した確認から新pairで購入する', async () => {
  const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined)
  const bodies: { requestId: string; items: { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }[] }[] = []
  const verification: { path: string; authorization: string | null }[] = []
  server.use(
    http.get('/api/auth/me', ({ request }) => { verification.push({ path: 'actor', authorization: request.headers.get('Authorization') }); return HttpResponse.json({ id: 1 }) }),
    http.get('/api/households/me', ({ request }) => { verification.push({ path: 'household', authorization: request.headers.get('Authorization') }); return HttpResponse.json({ id: 10 }) }),
    http.patch('/api/shopping-list-items/11', () => { setTokens('testuser_a_planned_access', 'testuser_a_refresh'); return HttpResponse.json({ id: 11, plannedQuantity: 3, purchaseRevision: 3 }) }),
    http.post('/api/shopping-list-items/purchases', async ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer testuser_a_planned_access')
      const body = await request.json() as typeof bodies[number]; bodies.push(body)
      return HttpResponse.json({ requestId: body.requestId, updatedInventoryItems: [{ id: 1, quantity: 2.5 }], removedShoppingListItemIds: [], remainingShoppingListItems: [{ id: 11, plannedQuantity: 1, purchaseRevision: 4 }] })
    }),
  )
  render(<ShoppingListPanel {...props} onRefresh={refresh} />)
  const check = screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする' })
  await waitFor(() => expect(check).toBeEnabled())
  await user.click(check)
  await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細' }))
  const actual = screen.getByRole('textbox', { name: 'testuser_品目1の実購入数' })
  await user.clear(actual); await user.type(actual, '2')
  await user.click(screen.getByRole('button', { name: '予定数を保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '予定数を保存' })).toBeEnabled())
  const planned = screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })
  await user.clear(planned); await user.type(planned, '5')
  expect(actual).toHaveValue('2')
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  expect(check).toBeChecked()
  verification.length = 0
  await user.click(screen.getByRole('button', { name: '購入を反映' }))
  expect(screen.getByRole('dialog', { name: '購入内容の確認' })).toHaveTextContent('testuser_品目1')
  expect(screen.getByRole('dialog', { name: '購入内容の確認' })).toHaveTextContent('2')
  expect(bodies).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '戻る' }))
  expect(check).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細' }))
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })).toHaveValue('5')
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の実購入数' })).toHaveValue('2')
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  await user.click(screen.getByRole('button', { name: '購入を反映' }))
  await user.click(screen.getByRole('button', { name: 'この内容で購入を反映' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(bodies).toEqual([{ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: [{ id: 11, purchasedQuantity: 2, expectedPurchaseRevision: 3 }] }])
  expect(verification).toEqual(['actor', 'household'].map(path => ({ path, authorization: 'Bearer testuser_a_planned_access' })))
  expect(screen.queryByRole('button', { name: '本人と世帯を再確認' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'testuser_品目1の詳細' })).toHaveTextContent('予定 1')
  await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細' }))
  expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数' })).toHaveValue('5')
})
beforeEach(() => {
  localStorage.clear(); setTokens('testuser_a_access','testuser_a_refresh'); vi.stubGlobal('isSecureContext',true)
  Object.defineProperty(navigator,'locks',{ configurable:true, value:{request:async (_n:string,_o:unknown,cb:()=>unknown)=>cb()} })
  server.use(http.get('/api/households/me',()=>HttpResponse.json({id:10})))
})
afterEach(()=>{clearTokens();vi.unstubAllGlobals()})
it.each([false,true])('通常追加は同refresh-sessionのaccess更新後も成功を受理し入力をリセットする: GET失敗=%s',async(failRefresh)=>{
 const user=userEvent.setup(),notify=vi.fn(),refresh=failRefresh?vi.fn().mockRejectedValue(new Error('GET')):vi.fn().mockResolvedValue(undefined)
 const bodies:unknown[]=[]
 server.use(http.post('/api/shopping-list-items',async({request})=>{bodies.push(await request.json());setTokens('testuser_a_new_access','testuser_a_refresh');return HttpResponse.json(shopping[0])}))
 render(<ShoppingListPanel {...props} onRefresh={refresh} onNotify={notify}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'品目を追加'})).toBeEnabled())
 await user.click(screen.getByRole('button',{name:'品目を追加'}));await user.selectOptions(screen.getByRole('combobox',{name:'追加する品目'}),'1');await user.type(screen.getByLabelText('値段（円・任意）'),'250');await user.click(screen.getByRole('button',{name:'追加'}))
 await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));expect(bodies).toEqual([{inventoryItemId:1,price:250}])
 await waitFor(()=>expect(screen.getByRole('button',{name:'品目を追加'})).toBeEnabled())
 expect(screen.queryByRole('combobox',{name:'追加する品目'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'testuser_品目1の詳細'})).toBeInTheDocument()
 if(failRefresh)expect(notify).toHaveBeenCalledWith('品目を追加しました。一覧の再取得に失敗しました');else expect(notify).not.toHaveBeenCalled()
 await user.click(screen.getByRole('button',{name:'品目を追加'}));expect(screen.getByRole('combobox',{name:'追加する品目'})).toHaveValue('');expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('')
})
it.each([false,true])('通常削除は同refresh-sessionのaccess更新後も成功を受理して詳細を閉じる: GET失敗=%s',async(failRefresh)=>{
 const user=userEvent.setup(),notify=vi.fn();let deletes=0
 server.use(http.delete('/api/shopping-list-items/11',()=>{deletes++;setTokens('testuser_a_delete_access','testuser_a_refresh');return new HttpResponse(null,{status:204})}))
 const refresh=failRefresh?vi.fn().mockRejectedValue(new Error('GET')):vi.fn().mockResolvedValue(undefined)
 render(<ShoppingListPanel {...props} onRefresh={refresh} onNotify={notify}/>);await waitFor(()=>expect(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).toBeEnabled())
 await user.click(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'}));await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('3');await user.click(screen.getByRole('button',{name:/削除/}))
 await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole('button',{name:'品目を追加'})).toBeEnabled())
 expect(deletes).toBe(1);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'品目を追加'})).toHaveFocus();expect(screen.getByRole('button',{name:'testuser_品目2の詳細'})).toBeInTheDocument()
 if(failRefresh)expect(notify).toHaveBeenCalledWith('削除しました。一覧の再取得に失敗しました');else expect(notify).not.toHaveBeenCalled()
 await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('')
})
it('通常予定PATCHは同refresh-sessionのaccess更新後も予定とrevisionを受理し実数を保持する',async()=>{
 const user=userEvent.setup(),bodies:unknown[]=[]
 server.use(http.patch('/api/shopping-list-items/11',async({request})=>{bodies.push(await request.json());setTokens('testuser_a_planned_access','testuser_a_refresh');return HttpResponse.json({id:11,plannedQuantity:4.5,purchaseRevision:3})}))
 render(<ShoppingListPanel {...props}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}))
 const planned=screen.getByRole('textbox',{name:'testuser_品目1の予定数'});await user.clear(planned);await user.type(planned,'4.5');await user.click(screen.getByRole('button',{name:'予定数を保存'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'予定数を保存'})).toBeEnabled());expect(bodies).toEqual([{plannedQuantity:4.5,expectedPurchaseRevision:2}]);expect(screen.getByRole('textbox',{name:'testuser_品目1の予定数'})).toHaveValue('4.5');expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('3')
 await user.click(screen.getByRole('button',{name:'閉じる'}));expect(screen.getByRole('button',{name:'testuser_品目1の詳細'})).toHaveTextContent('予定 4.5');expect(check).toBeChecked();expect(screen.getByRole('button',{name:'購入を反映'})).toBeEnabled();expect(screen.queryByText(/予定が変更されています/)).not.toBeInTheDocument()
})
it.each(['追加','予定PATCH'])('新refresh-sessionへ変わった通常操作の旧成功は破棄してdetachする: %s',async(operation)=>{
 const user=userEvent.setup(),refresh=vi.fn(),notify=vi.fn();let mutations=0
 const changed=()=>{mutations++;setTokens('testuser_relogin_access','testuser_relogin_refresh')}
 server.use(http.post('/api/shopping-list-items',()=>{changed();return HttpResponse.json(shopping[0])}),http.patch('/api/shopping-list-items/11',()=>{changed();return HttpResponse.json({id:11,plannedQuantity:5,purchaseRevision:3})}))
 render(<ShoppingListPanel {...props} onRefresh={refresh} onNotify={notify}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'品目を追加'})).toBeEnabled())
 if(operation==='追加'){await user.click(screen.getByRole('button',{name:'品目を追加'}));await user.selectOptions(screen.getByRole('combobox',{name:'追加する品目'}),'1');await user.click(screen.getByRole('button',{name:'追加'}))}
 else {await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));const planned=screen.getByRole('textbox',{name:'testuser_品目1の予定数'});await user.clear(planned);await user.type(planned,'5');await user.click(screen.getByRole('button',{name:'予定数を保存'}))}
 await screen.findByRole('button',{name:'本人と世帯を再確認'});expect(mutations).toBe(1);expect(refresh).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'testuser_品目1の詳細'})).not.toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it.each([false,true])('通常GET再取得は同refresh-sessionのaccess更新を受理して結果を通知する: GET失敗=%s',async(failRetry)=>{
 const user=userEvent.setup(),notify=vi.fn();let gets=0
 const refresh=vi.fn(async()=>{gets++;if(gets===1)throw new Error('first GET');setTokens('testuser_a_retry_access','testuser_a_refresh');if(failRetry)throw new Error('retry GET')})
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:3.5}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 render(<ShoppingListPanel {...props} onRefresh={refresh} onNotify={notify}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await screen.findByText('購入は反映済み。一覧を再取得してください')
 await user.click(screen.getByRole('button',{name:'一覧を再取得'}));await waitFor(()=>expect(notify).toHaveBeenCalledWith(failRetry?'一覧の再取得に失敗しました':'一覧を再取得しました'));expect(refresh).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'testuser_品目2の詳細'})).toBeInTheDocument()
 if(!failRetry){await user.click(screen.getByRole('checkbox',{name:'testuser_品目2を購入済みにする'}));expect(screen.getByRole('button',{name:'購入を反映'})).toBeEnabled()}
})
it.each([
 {failRefresh:false,untargeted:'zero'},
 {failRefresh:false,untargeted:'unchecked'},
 {failRefresh:true,untargeted:'zero'},
 {failRefresh:true,untargeted:'unchecked'},
])('部分購入後も未送信の予定5と未対象draftを保持する: GET失敗=$failRefresh / $untargeted',async({failRefresh,untargeted})=>{
 const user=userEvent.setup();let patches=0
 const bodies:{requestId:string;items:{id:number;purchasedQuantity:number;expectedPurchaseRevision:number}[]}[]=[]
 server.use(
  http.patch('/api/shopping-list-items/:id',()=>{patches++;return HttpResponse.json({},{status:500})}),
  http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as typeof bodies[number];bodies.push(body);return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:2.5}],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:11,plannedQuantity:1,purchaseRevision:3}]})}),
 )
 let update!:(items:typeof shopping)=>void
 const refresh=vi.fn(async()=>{if(failRefresh)throw new Error('GET');update([{...shopping[0],plannedQuantity:1,purchaseRevision:3},shopping[1]])})
 const view=render(<ShoppingListPanel {...props} onRefresh={refresh}/>);update=items=>view.rerender(<ShoppingListPanel {...props} shopping={items} onRefresh={refresh}/>)
 const first=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'}),second=screen.getByRole('checkbox',{name:'testuser_品目2を購入済みにする'})
 await waitFor(()=>expect(first).toBeEnabled());await user.click(first);await user.click(second)
 await user.click(screen.getByRole('button',{name:'testuser_品目2の詳細'}));const otherPlanned=screen.getByRole('textbox',{name:'testuser_品目2の予定数'});await user.clear(otherPlanned);await user.type(otherPlanned,'8')
 if(untargeted==='zero'){const actual=screen.getByRole('textbox',{name:'testuser_品目2の実購入数'});await user.clear(actual);await user.type(actual,'0')}
 await user.click(screen.getByRole('button',{name:'閉じる'}));if(untargeted==='unchecked')await user.click(second)
 await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));const planned=screen.getByRole('textbox',{name:'testuser_品目1の予定数'});await user.clear(planned);await user.type(planned,'5');const actual=screen.getByRole('textbox',{name:'testuser_品目1の実購入数'});await user.clear(actual);await user.type(actual,'2');await user.click(screen.getByRole('button',{name:'閉じる'}))
 expect(patches).toBe(0);await user.click(screen.getByRole('button',{name:'購入を反映'}));expect(bodies).toHaveLength(0);await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}))
 if(failRefresh)await screen.findByText('購入は反映済み。一覧を再取得してください');else await waitFor(()=>expect(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).toBeEnabled())
 await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));expect(bodies).toHaveLength(1);expect(bodies[0]).toEqual({requestId:expect.stringMatching(/^[0-9a-f-]{36}$/),items:[{id:11,purchasedQuantity:2,expectedPurchaseRevision:2}]});expect(patches).toBe(0)
 expect(screen.getByRole('button',{name:'testuser_品目1の詳細'})).toHaveTextContent('予定 1');expect(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).not.toBeChecked()
 await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の予定数'})).toHaveValue('5');expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('');await user.click(screen.getByRole('button',{name:'閉じる'}))
 expect(screen.getByRole('checkbox',{name:'testuser_品目2を購入済みにする'})).toHaveProperty('checked',untargeted==='zero');await user.click(screen.getByRole('button',{name:'testuser_品目2の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目2の予定数'})).toHaveValue('8');expect(screen.getByRole('textbox',{name:'testuser_品目2の実購入数'})).toHaveValue(untargeted==='zero'?'0':'3');expect(patches).toBe(0)
})
it('店舗groupと独立checkbox、予定初期の実数、取消/close/検索のdraft保持',async()=>{
 const user=userEvent.setup();render(<ShoppingListPanel {...props}/> )
 expect(screen.getByRole('region',{name:'店舗Aの買い物'})).toBeInTheDocument()
 const checkbox=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'})
 await waitFor(()=>expect(checkbox).toBeEnabled());await user.click(checkbox)
 await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}))
 const actual=screen.getByRole('textbox',{name:'testuser_品目1の実購入数'});expect(actual).toHaveValue('3')
 await user.clear(actual);await user.type(actual,'2.5');await user.click(screen.getByRole('button',{name:'閉じる'}))
 await user.click(screen.getByRole('button',{name:'購入を反映'}));expect(screen.getByRole('dialog',{name:'購入内容の確認'})).toHaveTextContent('2.5')
 await user.click(screen.getByRole('button',{name:'戻る'}));expect(checkbox).toBeChecked()
 await user.type(screen.getByRole('searchbox'),'該当なし');await user.clear(screen.getByRole('searchbox'))
 await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('2.5')
})
it('予定PATCHはCASと小数数を送り実数draftを変えない',async()=>{
 const bodies:unknown[]=[];server.use(http.patch('/api/shopping-list-items/11',async({request})=>{bodies.push(await request.json());return HttpResponse.json({id:11,plannedQuantity:4.5,purchaseRevision:3})}))
 const user=userEvent.setup();render(<ShoppingListPanel {...props}/>);await waitFor(()=>expect(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).toBeEnabled());await user.click(screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'}));await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}))
 const planned=screen.getByRole('textbox',{name:'testuser_品目1の予定数'});await user.clear(planned);await user.type(planned,'4.5');await user.click(screen.getByRole('button',{name:'予定数を保存'}))
 await waitFor(()=>expect(bodies).toEqual([{plannedQuantity:4.5,expectedPurchaseRevision:2}]))
 expect(screen.getByRole('textbox',{name:'testuser_品目1の実購入数'})).toHaveValue('3')
})
it('確認前POST0、unchecked/0除外、確定はrequestId/revisionを送り対象だけclear',async()=>{
 const bodies:{requestId:string;items:unknown[]}[]=[];server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string;items:unknown[]};bodies.push(body);return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:3.5}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 const user=userEvent.setup();render(<ShoppingListPanel {...props}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check)
 await user.click(screen.getByRole('button',{name:'購入を反映'}));expect(bodies).toHaveLength(0);await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}))
 await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/);expect(bodies[0].items).toEqual([{id:11,purchasedQuantity:3,expectedPurchaseRevision:2}]);await waitFor(()=>expect(screen.queryByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).not.toBeInTheDocument())
})
it.each(['','0','1.22','100000','-1'])('不正または0実数で確定しない: %s',async(text)=>{
 const user=userEvent.setup();render(<ShoppingListPanel {...props}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));const actual=screen.getByRole('textbox',{name:'testuser_品目1の実購入数'});await user.clear(actual);if(text)await user.type(actual,text);await user.click(screen.getByRole('button',{name:'閉じる'}));expect(screen.getByRole('button',{name:'購入を反映'})).toBeDisabled()
})
it('外部revision変更時は自動rebaseせず再チェックを求める',async()=>{
 const user=userEvent.setup(), {rerender}=render(<ShoppingListPanel {...props}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);rerender(<ShoppingListPanel {...props} shopping={[{...shopping[0],purchaseRevision:3},shopping[1]]}/>);expect(screen.getByRole('button',{name:'購入を反映'})).toBeDisabled();expect(screen.getByText(/予定が変更されています/)).toBeInTheDocument()
})

it.each(['zero','unchecked'])('成功後も未対象draftを保持: %s',async(mode)=>{
 const user=userEvent.setup();const bodies:{items:{id:number}[]}[]=[]
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string;items:{id:number}[]};bodies.push(body);return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:3.5}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 render(<ShoppingListPanel {...props}/>);const first=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'}),second=screen.getByRole('checkbox',{name:'testuser_品目2を購入済みにする'});await waitFor(()=>expect(first).toBeEnabled());await user.click(first);await user.click(second)
 if(mode==='zero'){await user.click(screen.getByRole('button',{name:'testuser_品目2の詳細'}));const actual=screen.getByRole('textbox',{name:'testuser_品目2の実購入数'});await user.clear(actual);await user.type(actual,'0');await user.click(screen.getByRole('button',{name:'閉じる'}))}else await user.click(second)
 await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await waitFor(()=>expect(screen.queryByRole('checkbox',{name:'testuser_品目1を購入済みにする'})).not.toBeInTheDocument());expect(bodies[0].items).toHaveLength(1);expect(bodies[0].items[0].id).toBe(11);expect((second as HTMLInputElement).checked).toBe(mode==='zero')
 await user.click(screen.getByRole('button',{name:'testuser_品目2の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目2の実購入数'})).toHaveValue(mode==='zero'?'0':'3')
})
it('成功後GET失敗から一覧再取得だけで回復し、新しい確認を再開できる',async()=>{
 const user=userEvent.setup(),refresh=vi.fn().mockRejectedValueOnce(new Error('GET')).mockResolvedValue(undefined);let posts=0
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{posts++;const body=await request.json() as {requestId:string};return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:3.5}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 render(<ShoppingListPanel {...props} onRefresh={refresh}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await screen.findByText('購入は反映済み。一覧を再取得してください');await user.click(screen.getByRole('button',{name:'一覧を再取得'}));expect(posts).toBe(1);expect(refresh).toHaveBeenCalledTimes(2);await user.click(screen.getByRole('checkbox',{name:'testuser_品目2を購入済みにする'}));expect(screen.getByRole('button',{name:'購入を反映'})).toBeEnabled()
})

it('自分の予定保存後の部分購入でも最新GETの予定残数を詳細入力へ表示する',async()=>{
 const user=userEvent.setup();let update!:(items:typeof shopping)=>void
 server.use(http.patch('/api/shopping-list-items/11',()=>HttpResponse.json({id:11,plannedQuantity:3,purchaseRevision:3})),http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:2.5}],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:11,plannedQuantity:1,purchaseRevision:4}]})}))
 const refresh=vi.fn(async()=>{update([{...shopping[0],plannedQuantity:1,purchaseRevision:4},shopping[1]])})
 const view=render(<ShoppingListPanel {...props} onRefresh={refresh}/>);update=(items)=>view.rerender(<ShoppingListPanel {...props} shopping={items} onRefresh={refresh}/>)
 const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));await user.click(screen.getByRole('button',{name:'予定数を保存'}));await waitFor(()=>expect(screen.getByRole('button',{name:'予定数を保存'})).toBeEnabled());const actual=screen.getByRole('textbox',{name:'testuser_品目1の実購入数'});await user.clear(actual);await user.type(actual,'2');await user.click(screen.getByRole('button',{name:'閉じる'}));await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await waitFor(()=>expect(refresh).toHaveBeenCalled());await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の予定数'})).toHaveValue('1')
})

it('成功後GET失敗でも保存済remainingをmetadataを保って表示する',async()=>{
 const user=userEvent.setup();server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:2.5}],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:11,plannedQuantity:1,purchaseRevision:3}]})}))
 render(<ShoppingListPanel {...props} onRefresh={vi.fn().mockRejectedValue(new Error('GET'))}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));const actual=screen.getByRole('textbox',{name:'testuser_品目1の実購入数'});await user.clear(actual);await user.type(actual,'2');await user.click(screen.getByRole('button',{name:'閉じる'}));await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await screen.findByText('購入は反映済み。一覧を再取得してください');await user.click(screen.getByRole('button',{name:'testuser_品目1の詳細'}));expect(screen.getByRole('textbox',{name:'testuser_品目1の予定数'})).toHaveValue('1');expect(screen.getByText('testuser_品目1',{selector:'dd'})).toBeInTheDocument();expect(screen.getByText('未設定')).toBeInTheDocument()
})

it('保存済成功で除外された対象はGET失敗でも消え、未購入行を保持する',async()=>{
 const user=userEvent.setup();server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:3.5}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 render(<ShoppingListPanel {...props} onRefresh={vi.fn().mockRejectedValue(new Error('GET'))}/>);const check=screen.getByRole('checkbox',{name:'testuser_品目1を購入済みにする'});await waitFor(()=>expect(check).toBeEnabled());await user.click(check);await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}));await screen.findByText('購入は反映済み。一覧を再取得してください');expect(screen.queryByRole('button',{name:'testuser_品目1の詳細'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'testuser_品目2の詳細'})).toBeInTheDocument()
})

it.each([false, true])('同じ本人/sessionの世帯変更は再確認後も新一覧の完了まで旧行とdraftを隔離する: GET失敗=%s', async (failFirstRefresh) => {
 const user = userEvent.setup(), gates = [deferred(), deferred()], notify = vi.fn()
 const freshInventory = [{ ...inventory[0], id: 31, name: 'testuser_新世帯品目', quantity: 7.5 }]
 const freshShopping = [{ ...shopping[0], id: 41, inventoryItemId: 31, name: freshInventory[0].name, plannedQuantity: 6, purchaseRevision: 0 }]
 let publish!: () => void, posts = 0, refreshCount = 0
 const refresh = vi.fn(async () => {
  const index = refreshCount++; await gates[index].promise
  if (index === 0 && failFirstRefresh) throw new Error('list GET failed')
  publish()
 })
 server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1 })), http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
 const view = render(<ShoppingListPanel {...props} onRefresh={refresh} onNotify={notify} />)
 publish = () => view.rerender(<ShoppingListPanel {...props} shopping={freshShopping} inventory={freshInventory} onRefresh={refresh} onNotify={notify} />)
 await waitFor(() => expect(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする', exact: true })).toBeEnabled())
 await user.click(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする', exact: true }))
 await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細', exact: true }))
 const planned = screen.getByRole('textbox', { name: 'testuser_品目1の予定数', exact: true })
 await user.clear(planned); await user.type(planned, '8')
 await user.click(screen.getByRole('button', { name: '閉じる', exact: true }))
 server.use(http.get('/api/households/me', () => HttpResponse.json({ id: 20 })))
 await user.click(screen.getByRole('button', { name: '購入を反映', exact: true }))
 await user.click(screen.getByRole('button', { name: 'この内容で購入を反映', exact: true }))
 await screen.findByRole('button', { name: '本人と世帯を再確認', exact: true })
 const expectOldHidden = () => {
  for (const item of shopping) {
   expect(screen.queryByRole('button', { name: item.name + 'の詳細', exact: true })).not.toBeInTheDocument()
   expect(screen.queryByRole('checkbox', { name: item.name + 'を購入済みにする', exact: true })).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('dialog', { name: '買い物詳細', exact: true })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '購入内容の確認', exact: true })).not.toBeInTheDocument()
 }
 expectOldHidden(); expect(posts).toBe(0)
 try {
  await user.click(screen.getByRole('button', { name: '本人と世帯を再確認', exact: true }))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expectOldHidden()
  expect(screen.getByRole('button', { name: '品目を追加', exact: true })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'testuser_新世帯品目の詳細', exact: true })).not.toBeInTheDocument()
  await act(async () => { gates[0].resolve() })
  if (failFirstRefresh) {
   const retry = await screen.findByRole('button', { name: '一覧を再取得', exact: true })
   expectOldHidden(); expect(screen.getByRole('button', { name: '品目を追加', exact: true })).toBeDisabled()
   await user.click(retry); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
   expectOldHidden()
   await act(async () => { gates[1].resolve() })
  }
  const freshCheck = await screen.findByRole('checkbox', { name: 'testuser_新世帯品目を購入済みにする', exact: true })
  await waitFor(() => expect(freshCheck).toBeEnabled())
  expectOldHidden(); expect(freshCheck).not.toBeChecked(); expect(posts).toBe(0)
  await user.click(screen.getByRole('button', { name: 'testuser_新世帯品目の詳細', exact: true }))
  expect(screen.getByRole('textbox', { name: 'testuser_新世帯品目の予定数', exact: true })).toHaveValue('6')
  expect(screen.getByRole('textbox', { name: 'testuser_新世帯品目の実購入数', exact: true })).toHaveValue('')
  expect(screen.getByText('7.5', { selector: 'dd' })).toBeInTheDocument()
 } finally { gates.forEach(gate => gate.resolve()) }
})

it.each([false, true])('同じscopeの再確認は予定/実数draftを保持し一覧を取り直さない: access更新=%s', async (rotateAccess) => {
 const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined)
 server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1 })))
 render(<ShoppingListPanel {...props} onRefresh={refresh} />)
 await waitFor(() => expect(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする', exact: true })).toBeEnabled())
 await user.click(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする', exact: true }))
 await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細', exact: true }))
 const planned = screen.getByRole('textbox', { name: 'testuser_品目1の予定数', exact: true }), actual = screen.getByRole('textbox', { name: 'testuser_品目1の実購入数', exact: true })
 await user.clear(planned); await user.type(planned, '8'); await user.clear(actual); await user.type(actual, '2.5')
 await user.click(screen.getByRole('button', { name: '閉じる', exact: true }))
 // A failed verification offers the existing explicit recheck without detaching the draft.
 server.use(http.get('/api/households/me', () => HttpResponse.json({}, { status: 503 })))
 await user.click(screen.getByRole('button', { name: '購入を反映', exact: true }))
 await user.click(screen.getByRole('button', { name: 'この内容で購入を反映', exact: true }))
 await screen.findByRole('button', { name: '本人と世帯を再確認', exact: true })
 if (rotateAccess) setTokens('testuser_a_rotated_access', 'testuser_a_refresh')
 server.use(http.get('/api/households/me', () => HttpResponse.json({ id: 10 })))
 await user.click(screen.getByRole('button', { name: '本人と世帯を再確認', exact: true }))
 await waitFor(() => expect(screen.getByRole('button', { name: '購入を反映', exact: true })).toBeEnabled())
 expect(refresh).not.toHaveBeenCalled()
 expect(screen.getByRole('checkbox', { name: 'testuser_品目1を購入済みにする', exact: true })).toBeChecked()
 await user.click(screen.getByRole('button', { name: 'testuser_品目1の詳細', exact: true }))
 expect(screen.getByRole('textbox', { name: 'testuser_品目1の予定数', exact: true })).toHaveValue('8')
 expect(screen.getByRole('textbox', { name: 'testuser_品目1の実購入数', exact: true })).toHaveValue('2.5')
})
