import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { shoppingEnvironment } from '../shoppingEnvironment'
import { ZaikoPage } from '../../pages/ZaikoPage'
import { apiClient } from '../../api/client'
import { getAccessToken, getRefreshToken, setTokens } from '../../api/tokenStorage'
shoppingEnvironment()
const item={id:11,inventoryItemId:1,name:'testuser_品目',isManual:true,purchased:false,purchasedQuantity:0,plannedQuantity:1,purchaseRevision:0}
function common(){server.use(http.get('/api/zaiko-categories',()=>HttpResponse.json([])),http.get('/api/stores',()=>HttpResponse.json([])),http.get('/api/inventory-items',()=>HttpResponse.json([])))}
it('初回GETの401をaccessのみrefreshして再試行した一覧と在庫を表示する',async()=>{
 common();let refreshes=0;const shoppingAuth:(string|null)[]=[]
 server.use(
  http.get('/api/inventory-items',()=>HttpResponse.json([{id:1,name:item.name,categoryId:1,storeId:null,quantity:2.5,threshold:1,dailyConsumption:null,autoConsumptionEnabled:false}])),
  http.get('/api/shopping-list-items',({request})=>{const auth=request.headers.get('authorization');shoppingAuth.push(auth);return auth==='Bearer testuser_access'?HttpResponse.json({code:'UNAUTHORIZED'},{status:401}):HttpResponse.json([item])}),
  http.post('/api/auth/refresh',async({request})=>{refreshes++;expect(await request.json()).toEqual({refreshToken:'testuser_refresh'});return HttpResponse.json({accessToken:'testuser_refreshed_access',expiresIn:900})}),
 )
 render(<MemoryRouter initialEntries={['/zaiko/shopping']}><ZaikoPage/></MemoryRouter>)
 const row=await screen.findByRole('button',{name:'testuser_品目の詳細'})
 expect(within(row).getByText('在庫 2.5')).toBeInTheDocument()
 expect(screen.queryByText('買い物リストは空です')).not.toBeInTheDocument()
 expect(shoppingAuth).toEqual(['Bearer testuser_access','Bearer testuser_refreshed_access']);expect(refreshes).toBe(1)
 expect(getAccessToken()).toBe('testuser_refreshed_access');expect(getRefreshToken()).toBe('testuser_refresh')
})
it('並替GETの401を同じrefresh-sessionで再試行した新しい予定数を表示する',async()=>{
 common();let refreshes=0;const sortAuth:(string|null)[]=[]
 server.use(
  http.get('/api/shopping-list-items',({request})=>{if(new URL(request.url).searchParams.get('sort')!=='name')return HttpResponse.json([item]);const auth=request.headers.get('authorization');sortAuth.push(auth);return auth==='Bearer testuser_access'?HttpResponse.json({code:'UNAUTHORIZED'},{status:401}):HttpResponse.json([{...item,plannedQuantity:7,purchaseRevision:1}])}),
  http.post('/api/auth/refresh',()=>{refreshes++;return HttpResponse.json({accessToken:'testuser_sort_access',expiresIn:900})}),
 )
 const user=userEvent.setup();render(<MemoryRouter initialEntries={['/zaiko/shopping']}><ZaikoPage/></MemoryRouter>);await screen.findByRole('button',{name:'testuser_品目の詳細'})
 await user.selectOptions(screen.getByRole('combobox',{name:'並び替え'}),'name')
 await waitFor(()=>expect(within(screen.getByRole('button',{name:'testuser_品目の詳細'})).getByText('予定 7')).toBeInTheDocument())
 expect(sortAuth).toEqual(['Bearer testuser_access','Bearer testuser_sort_access']);expect(refreshes).toBe(1);expect(getRefreshToken()).toBe('testuser_refresh')
})
it.each(['別user','同user再login'])('新refresh-sessionへの切替後は遅い並替GETを採用しない: %s',async(mode)=>{
 common();let release!:()=>void,entered!:()=>void,completed!:()=>void
 const gate=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{entered=r}),finished=new Promise<void>(r=>{completed=r})
 server.use(http.get('/api/shopping-list-items',async({request})=>{if(new URL(request.url).searchParams.get('sort')==='name'){entered();await gate;return HttpResponse.json([{...item,plannedQuantity:9}])}return HttpResponse.json([item])}))
 const user=userEvent.setup();render(<MemoryRouter initialEntries={['/zaiko/shopping']}><ZaikoPage/></MemoryRouter>);await screen.findByRole('button',{name:'testuser_品目の詳細'})
 const interceptor=apiClient.interceptors.response.use(response=>{if(response.config.url==='/shopping-list-items'&&response.config.params?.sort==='name')completed();return response})
 try {
  await user.selectOptions(screen.getByRole('combobox',{name:'並び替え'}),'name');await arrived
  setTokens(mode==='別user'?'testuser_other_access':'testuser_relogin_access',mode==='別user'?'testuser_other_refresh':'testuser_relogin_refresh')
  await act(async()=>{release();await finished})
  expect(within(screen.getByRole('button',{name:'testuser_品目の詳細'})).getByText('予定 1')).toBeInTheDocument();expect(screen.queryByText('予定 9')).not.toBeInTheDocument()
 } finally { release();apiClient.interceptors.response.eject(interceptor) }
})
it('初回一覧失敗を空一覧と区別しGET再取得で回復する',async()=>{
 common();let fail=true;server.use(http.get('/api/shopping-list-items',()=>fail?HttpResponse.json({},{status:503}):HttpResponse.json([item])))
 const user=userEvent.setup();render(<MemoryRouter initialEntries={['/zaiko/shopping']}><ZaikoPage/></MemoryRouter>)
 await screen.findByRole('button',{name:'再取得'});expect(screen.queryByText('買い物リストは空です')).not.toBeInTheDocument();fail=false;await user.click(screen.getByRole('button',{name:'再取得'}));await screen.findByRole('button',{name:'testuser_品目の詳細'})
})
it('遅い旧並替GETが新しいGETの予定数を上書きしない',async()=>{
 common();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{entered=r})
 server.use(http.get('/api/shopping-list-items',async({request})=>{const sort=new URL(request.url).searchParams.get('sort');if(sort==='name'){entered();await gate;return HttpResponse.json([{...item,plannedQuantity:9}])}return HttpResponse.json([{...item,plannedQuantity:sort==='category'?3:1}])}))
 const user=userEvent.setup();render(<MemoryRouter initialEntries={['/zaiko/shopping']}><ZaikoPage/></MemoryRouter>);await screen.findByRole('button',{name:'testuser_品目の詳細'})
 await user.selectOptions(screen.getByRole('combobox',{name:'並び替え'}),'name');await arrived;await user.selectOptions(screen.getByRole('combobox',{name:'並び替え'}),'category');await waitFor(()=>expect(within(screen.getByRole('button',{name:'testuser_品目の詳細'})).getByText('予定 3')).toBeInTheDocument());release();await waitFor(()=>expect(screen.queryByText('予定 9')).not.toBeInTheDocument())
})
