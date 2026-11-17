import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'
import { setTokens, clearTokens } from '../../api/tokenStorage'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
const inventory=[1,2].map(id=>({id,name:'testuser_品目'+id,categoryId:1,storeId:null,quantity:0,threshold:10,dailyConsumption:null,autoConsumptionEnabled:false}))
const shopping=inventory.map(item=>({id:item.id+10,inventoryItemId:item.id,name:item.name,isManual:false,purchased:false,purchasedQuantity:0,plannedQuantity:1,purchaseRevision:0,price:null}))
const props={shopping,inventory,categories:[{id:1,name:'食品',isDefault:true}],stores:[],sort:'store' as const,onSortChange:vi.fn(),onRefresh:vi.fn().mockResolvedValue(undefined),onNotify:vi.fn()}
beforeEach(()=>{localStorage.clear();setTokens('testuser_access','testuser_refresh');vi.stubGlobal('isSecureContext',true);Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,_o:unknown,cb:()=>unknown)=>cb()}});server.use(http.get('/api/households/me',()=>HttpResponse.json({id:10})))})
afterEach(()=>{clearTokens();vi.unstubAllGlobals()})
async function check(user:ReturnType<typeof userEvent.setup>,id=0){const checkbox=screen.getByRole('checkbox',{name:shopping[id].name+'を購入済みにする'});await waitFor(()=>expect(checkbox).toBeEnabled());await user.click(checkbox)}
async function reflect(user:ReturnType<typeof userEvent.setup>){await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.click(screen.getByRole('button',{name:'この内容で購入を反映'}))}
it('複数品目を保持し一度だけ送信、通信中対象変更/削除を無効にして閉じるは許可',async()=>{
 const user=userEvent.setup(), bodies:{requestId:string;items:{id:number;purchasedQuantity:number;expectedPurchaseRevision:number}[]}[]=[];let release!:()=>void;const blocked=new Promise<void>(r=>{release=r})
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as typeof bodies[number];bodies.push(body);await blocked;return HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:1},{id:2,quantity:1}],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:11,plannedQuantity:1,purchaseRevision:1},{id:12,plannedQuantity:1,purchaseRevision:1}]})}))
 render(<ShoppingListPanel {...props}/>);await check(user);await check(user,1);expect(bodies).toHaveLength(0)
 await user.click(screen.getByRole('button',{name:'購入を反映'}));await user.dblClick(screen.getByRole('button',{name:'この内容で購入を反映'}));await user.click(screen.getByRole('button',{name:shopping[0].name+'の詳細'}))
 expect(screen.getByRole('button',{name:shopping[0].name+'を削除'})).toBeDisabled();expect(screen.getByRole('textbox',{name:shopping[0].name+'の実購入数'})).toBeDisabled();expect(screen.getByRole('button',{name:'閉じる'})).toBeEnabled()
 expect(bodies[0].items).toEqual([{id:11,purchasedQuantity:1,expectedPurchaseRevision:0},{id:12,purchasedQuantity:1,expectedPurchaseRevision:0}]);release();await waitFor(()=>expect(screen.getByRole('textbox',{name:shopping[0].name+'の実購入数'})).toHaveValue(''));expect(bodies).toHaveLength(1)
})
it('unknown時入力を保持、元key回復成功後GET失敗は対象clearしてGETだけ再試行',async()=>{
 const user=userEvent.setup();let posts=0,first=true;const notify=vi.fn(),refresh=vi.fn().mockRejectedValue(new Error('refresh'))
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{posts++;const body=await request.json() as {requestId:string};return first?HttpResponse.json({}, {status:500}):HttpResponse.json({requestId:body.requestId,updatedInventoryItems:[{id:1,quantity:1}],removedShoppingListItemIds:[11],remainingShoppingListItems:[]})}))
 render(<ShoppingListPanel {...props} onNotify={notify} onRefresh={refresh}/>);await check(user);await reflect(user);await screen.findByRole('button',{name:'前回の購入結果を確認'});expect(screen.getByRole('checkbox',{name:shopping[0].name+'を購入済みにする'})).toBeChecked()
 first=false;await user.click(screen.getByRole('button',{name:'前回の購入結果を確認'}));await screen.findByText('購入は反映済み。一覧を再取得してください');expect(screen.queryByRole('checkbox',{name:shopping[0].name+'を購入済みにする'})).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'一覧を再取得'}));expect(posts).toBe(2);expect(refresh).toHaveBeenCalledTimes(2)
})
it('削除失敗は詳細と入力を保持、成功時対象だけclearし追加へfocus復帰',async()=>{
 const user=userEvent.setup(),notify=vi.fn();const {rerender}=render(<ShoppingListPanel {...props} onNotify={notify}/>);await check(user);await check(user,1)
 server.use(http.delete('/api/shopping-list-items/11',()=>HttpResponse.json({message:'testuser_削除失敗'},{status:500})))
 await user.click(screen.getByRole('button',{name:shopping[0].name+'の詳細'}));await user.click(screen.getByRole('button',{name:shopping[0].name+'を削除'}));await waitFor(()=>expect(notify).toHaveBeenCalledWith('testuser_削除失敗'));expect(screen.getByRole('textbox',{name:shopping[0].name+'の実購入数'})).toHaveValue('1')
 server.use(http.delete('/api/shopping-list-items/11',()=>new HttpResponse(null,{status:204})));await user.click(screen.getByRole('button',{name:shopping[0].name+'を削除'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(screen.getByRole('button',{name:'品目を追加'})).toHaveFocus();rerender(<ShoppingListPanel {...props} shopping={[shopping[1]]}/>);expect(screen.getByRole('checkbox',{name:shopping[1].name+'を購入済みにする'})).toBeChecked()
})
it('最新props/背景close/hidden中キー/対象消失を扱う',async()=>{
 const user=userEvent.setup();const {rerender}=render(<div><button>外部</button><ShoppingListPanel {...props}/></div>);await user.click(screen.getByRole('button',{name:shopping[0].name+'の詳細'}));rerender(<div><button>外部</button><ShoppingListPanel {...props} shopping={[{...shopping[0],price:9999999999}]}/></div>);expect(within(screen.getByRole('dialog')).getByText('9,999,999,999円')).toBeInTheDocument();fireEvent.click(screen.getByRole('dialog').parentElement!);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:shopping[0].name+'の詳細'}));const panel=screen.getByTestId('shopping-panel');panel.hidden=true;screen.getByRole('button',{name:'外部'}).focus();const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});document.activeElement?.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);panel.hidden=false;rerender(<div><button>外部</button><ShoppingListPanel {...props} shopping={[]}/></div>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'品目を追加'})).toHaveFocus()
})
it('checkboxは詳細buttonの外、0円/未指定/現在庫を表示しEscで行へ戻る',async()=>{
 const user=userEvent.setup();render(<ShoppingListPanel {...props} shopping={[{...shopping[0],price:0}]}/>);await check(user);const row=screen.getByRole('button',{name:shopping[0].name+'の詳細'});expect(row.querySelector('button,input')).toBeNull();await user.click(row);expect(screen.getByText('0円')).toBeInTheDocument();expect(screen.getByText('なし')).toBeInTheDocument();expect(screen.getByRole('button',{name:'買い物詳細を閉じる'})).toHaveFocus();await user.keyboard('{Escape}');expect(row).toHaveFocus();expect(screen.getByRole('checkbox',{name:shopping[0].name+'を購入済みにする'})).toBeChecked()
})

it('長名でも上部の明示closeを初期focusにし、末尾closeと起点復帰を維持する',async()=>{
 const user=userEvent.setup(),name='testuser_長い買い物品名'.repeat(20)
 render(<ShoppingListPanel {...props} shopping={[{...shopping[0],name}]}/> )
 const row=screen.getByRole('button',{name:name+'の詳細'});await user.click(row)
 const dialog=screen.getByRole('dialog',{name:'買い物詳細'}),top=within(dialog).getByRole('button',{name:'買い物詳細を閉じる'}),last=within(dialog).getByRole('button',{name:'閉じる'})
 expect(top).toHaveFocus();expect(top.compareDocumentPosition(within(dialog).getByText(name)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
 expect(within(dialog).getByRole('button',{name:name+'を削除'})).not.toHaveFocus()
 await user.click(top);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(row).toHaveFocus()
 await user.keyboard('{Enter}');const reopened=screen.getByRole('dialog',{name:'買い物詳細'});expect(within(reopened).getByRole('button',{name:'買い物詳細を閉じる'})).toHaveFocus()
 await user.tab({shift:true});expect(within(reopened).getByRole('button',{name:'閉じる'})).toHaveFocus();await user.click(within(reopened).getByRole('button',{name:'閉じる'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(row).toHaveFocus();expect(last).not.toBeInTheDocument()
})
