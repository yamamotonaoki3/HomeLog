import { env } from 'cloudflare:test'
import { beforeEach, expect, it, vi } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { currentWeekStart, getJstToday } from '../../lib/date'
import { consumptionDate } from '../../lib/inventory-consumption'

let headers: Record<string,string>, householdId: number, categoryId: number, recipeId: number
const request = (method: string, path: string, body?: unknown) => app.request('/api/'+path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
type Aggregate = { id:number; quantity:number; menuPlanEnabled:boolean; menuPlanRevision:number; menuLinks:{id:number;recipeId:number|null;remainingCount:number;memo:string|null;revision:number;carryEnabled:boolean}[]; linkedMenuEntries:{id:number;recipeTitle:string;usageQuantity:number}[] }
const line = (remainingCount=2) => ({recipeId,remainingCount,memo:null,carryEnabled:false})
const body = (links:unknown[]=[line(),{newRecipeTitle:'[E2E_TEST] oyakodon',remainingCount:3,memo:' spicy ',carryEnabled:true}], enabled=true) => ({name:'[E2E_TEST] chicken',categoryId,storeId:null,quantity:5,threshold:1,price:123,dailyConsumption:null,autoConsumptionEnabled:false,menuPlan:{requestId:crypto.randomUUID(),enabled,links}})
const edit = (item:Aggregate, links:unknown[]=item.menuLinks.map(l=>({linkId:l.id,remainingCount:l.remainingCount,memo:l.memo,carryEnabled:l.carryEnabled}))) => ({...body(links,item.menuPlanEnabled),quantity:item.quantity,expectedMenuPlanRevision:item.menuPlanRevision})
async function create(data=body()):Promise<Aggregate> {const response=await request('POST','inventory-items',data);expect(response.status).toBe(201);const item=await response.json<Aggregate>();expect(item.menuLinks).toBeInstanceOf(Array);return item}
async function counts() {return Promise.all(['inventory_items','recipes','inventory_menu_links','menu_entries','menu_operation_requests','shopping_list_items'].map(table=>env.DB.prepare('SELECT count(*) AS n FROM '+table+' WHERE household_id=?').bind(householdId).first()))}
beforeEach(async()=>{
 const user=(await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_plan') RETURNING id").bind('testuser_'+crypto.randomUUID()+'@example.com').first<{id:number}>())!
 householdId=(await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] atomic plan',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!.id
 await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(householdId,user.id).run()
 categoryId=(await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food') RETURNING id").bind(householdId).first<{id:number}>())!.id
 recipeId=(await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title,source_type) VALUES(?,?,'[E2E_TEST] curry','manual') RETURNING id").bind(householdId,user.id).first<{id:number}>())!.id
 headers={'Content-Type':'application/json',Authorization:'Bearer '+await signAccessToken(user.id,env.JWT_SECRET,900)}
})
it.each([5,5.5,6])('在庫%sへ2+3回を一括保存し未割当を許可、全DTOと週行を確定する',async quantity=>{
 const created=await create({...body(),quantity})
 expect(created).toMatchObject({quantity,menuPlanEnabled:true,menuPlanRevision:expect.any(Number),menuLinks:[{recipeId,remainingCount:2,memo:null},{remainingCount:3,memo:' spicy ',carryEnabled:true}]})
 expect(created.linkedMenuEntries).toHaveLength(2)
 expect(created.linkedMenuEntries.every(e=>e.usageQuantity===1)).toBe(true)
 expect((await env.DB.prepare('SELECT week_start_date FROM menu_entries WHERE household_id=?').bind(householdId).all()).results).toEqual([{week_start_date:currentWeekStart(getJstToday())},{week_start_date:currentWeekStart(getJstToday())}])
})
it.each([true,false])('品目enabled=%sでも2+4回は全未反映400',async enabled=>{
 const before=await counts(),data=body([line(),{newRecipeTitle:'[E2E_TEST] excess',remainingCount:4,memo:null,carryEnabled:false}],enabled)
 expect((await request('POST','inventory-items',data)).status).toBe(400)
 expect(await counts()).toEqual(before)
})
it('全件置換は省略linkを解除、同原本の再追加は新ID、順序・メモを保存する',async()=>{
 const first=await create(),oldLink=first.menuLinks[0]
 const removed=await request('PUT','inventory-items/'+first.id,edit(first,[{linkId:first.menuLinks[1].id,remainingCount:1,memo:' untouched text ',carryEnabled:true}]))
 expect(removed.status).toBe(200)
 const second=await removed.json<Aggregate>()
 expect(second.menuLinks).toHaveLength(1)
 expect(second.menuLinks[0]).toMatchObject({remainingCount:1,memo:' untouched text '})
 expect(await env.DB.prepare('SELECT id FROM recipes WHERE id=?').bind(recipeId).first()).toEqual({id:recipeId})
 const added=await request('PUT','inventory-items/'+first.id,edit(second,[line(3),{linkId:second.menuLinks[0].id,remainingCount:1,memo:null,carryEnabled:false}]))
 expect(added.status).toBe(200)
 const third=await added.json<Aggregate>()
 expect(third.menuLinks.map(l=>l.recipeId)).toEqual([recipeId,second.menuLinks[0].recipeId])
 expect(third.menuLinks[0].id).not.toBe(oldLink.id)
 expect(third.quantity).toBe(5)
})
it('unlinkはイベント参照週行とtitleを保持し、イベントを再追加linkへ付け替えない',async()=>{
 const first=await create(),link=first.menuLinks[0],entry=first.linkedMenuEntries[0]
 await env.DB.prepare("INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths,plan_count_delta,inventory_menu_link_id) VALUES('testuser_plan_event',?,?,?,?,1,?)").bind(householdId,entry.id,first.id,10,link.id).run()
 const removed=await request('PUT','inventory-items/'+first.id,edit(first,[]))
 expect(removed.status).toBe(200)
 expect(await env.DB.prepare('SELECT inventory_menu_link_id,recipe_title_snapshot FROM menu_entries WHERE id=?').bind(entry.id).first()).toEqual({inventory_menu_link_id:null,recipe_title_snapshot:'[E2E_TEST] curry'})
 const second=await removed.json<Aggregate>()
 expect((await request('PUT','inventory-items/'+first.id,edit(second,[line()]))).status).toBe(200)
 expect(await env.DB.prepare("SELECT inventory_item_id,inventory_menu_link_id,quantity_tenths FROM menu_consumption_events WHERE id='testuser_plan_event'").first()).toEqual({inventory_item_id:first.id,inventory_menu_link_id:null,quantity_tenths:10})
})
it('旧小数usageと週snapshotと履歴量を変えず明示指定linkだけ整数計画へ変換する',async()=>{
 const legacyBody={...body(),menuPlan:undefined,menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,usageQuantity:1.5}]}}
 const legacy=await (await request('POST','inventory-items',legacyBody)).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const item=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(legacy.id).first<{menu_plan_revision:number}>())!
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(legacy.id).first<{id:number}>())!
 await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] renamed',recipeId).run()
 const response=await request('PUT','inventory-items/'+legacy.id,{...body([{linkId:link.id,remainingCount:2,memo:'new',carryEnabled:false}]),expectedMenuPlanRevision:item.menu_plan_revision})
 expect(response.status).toBe(200)
 const saved=await response.json<Aggregate>()
 expect(saved.linkedMenuEntries[0]).toMatchObject({recipeTitle:'[E2E_TEST] curry',usageQuantity:1.5})
 expect(await env.DB.prepare('SELECT usage_tenths,remaining_count FROM inventory_menu_links WHERE id=?').bind(link.id).first()).toEqual({usage_tenths:15,remaining_count:2})
})
it('0回はcarry設定を保持して不要な週行を作らず、品目OFFでも計画を保持する',async()=>{
 const item=await create({...body([{...line(0),carryEnabled:true}],false),quantity:0})
 expect(item.menuLinks[0]).toMatchObject({remainingCount:0,carryEnabled:true})
 expect(item.linkedMenuEntries).toEqual([])
})
it.each([true,false])('dailyONと正数計画は品目enabled=%sでも400',async enabled=>{
 const before=await counts()
 expect((await request('POST','inventory-items',{...body([line()],enabled),dailyConsumption:1,autoConsumptionEnabled:true})).status).toBe(400)
 expect(await counts()).toEqual(before)
})
it('dailyONから明示OFFの同保存で未精算分と数量差分を反映し過去消費を復活させない',async()=>{
 const ordinary=await (await request('POST','inventory-items',{...body(),menuPlan:undefined,dailyConsumption:1,autoConsumptionEnabled:true})).json<{id:number}>()
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.UTC(2026,10,15,6))
 const actor=(await env.DB.prepare('SELECT user_id FROM household_members WHERE household_id=?').bind(householdId).first<{user_id:number}>())!
 headers.Authorization='Bearer '+await signAccessToken(actor.user_id,env.JWT_SECRET,900)
 const past=new Date(Date.now()-2*86400000)
 await env.DB.prepare('UPDATE inventory_items SET last_consumed_on=? WHERE id=?').bind(consumptionDate(past.getTime()),ordinary.id).run()
 const current=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(ordinary.id).first<{menu_plan_revision:number}>())!
 let response:Response
 try { response=await request('PUT','inventory-items/'+ordinary.id,{...body([line(2)]),quantity:6,dailyConsumption:1,autoConsumptionEnabled:false,expectedMenuPlanRevision:current.menu_plan_revision}) } finally {clock.mockRestore()}
 expect(response.status).toBe(200)
 const saved=await response.json<Aggregate>()
 // 5 - two old daily units + submitted delta(+1) = 4 (at JST>=01:00).
 expect(saved.quantity).toBe(4)
 expect(await env.DB.prepare('SELECT daily_consumption_tenths,auto_consumption_enabled FROM inventory_items WHERE id=?').bind(ordinary.id).first()).toEqual({daily_consumption_tenths:10,auto_consumption_enabled:0})
})
it.each([
 ['count fraction',{remainingCount:0.5}],['count max',{remainingCount:100000}],['memo max',{memo:'a'.repeat(256)}],['two discriminators',{newRecipeTitle:'[E2E_TEST] invalid'}],['missing discriminator',{recipeId:undefined}],['extra key',{enabled:false}],
] as const)('%sを400で拒否する',async(_name,change)=>{
 const before=await counts()
 expect((await request('POST','inventory-items',body([{...line(),...change}]))).status).toBe(400)
 expect(await counts()).toEqual(before)
})
it('重複recipeとlinkId、外部recipe/link、作成revision、legacy併用を拒否する',async()=>{
 expect((await request('POST','inventory-items',body([line(),line()]))).status).toBe(400)
 expect((await request('POST','inventory-items',{...body(),expectedMenuPlanRevision:0})).status).toBe(400)
 expect((await request('POST','inventory-items',{...body(),menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId}]}})).status).toBe(400)
 expect((await request('POST','inventory-items',body([{...line(),recipeId:999999}]))).status).toBe(404)
 const first=await create(),dup={linkId:first.menuLinks[0].id,remainingCount:1,memo:null,carryEnabled:false}
 expect((await request('PUT','inventory-items/'+first.id,edit(first,[dup,dup]))).status).toBe(400)
 expect((await request('PUT','inventory-items/'+first.id,edit(first,[{...dup,linkId:999999}]))).status).toBe(404)
 expect((await request('PUT','inventory-items/'+first.id,edit(first,[dup,line()]))).status).toBe(400)
})
it('同UUID並行createは副作用一度・同snapshot再現、異bodyはmismatch',async()=>{
 const data=body(),responses=await Promise.all([request('POST','inventory-items',data),request('POST','inventory-items',data)])
 expect(responses.map(r=>r.status)).toEqual([201,201])
 const first=await responses[0].json<Aggregate>()
 expect(await responses[1].json()).toEqual(first)
 expect(await counts()).toEqual([{n:1},{n:2},{n:2},{n:2},{n:1},{n:0}])
 const mismatch=await request('POST','inventory-items',{...data,quantity:7})
 expect(mismatch.status).toBe(409)
 expect(await mismatch.json()).toMatchObject({code:'RESOURCE_CONFLICT',details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]})
 await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(first.id).run()
 expect(await (await request('POST','inventory-items',data)).json()).toEqual(first)
})
it('PUT成功再送は古いrevisionより先に再現し、別要求のstaleは409',async()=>{
 const first=await create(),data=edit(first)
 const response=await request('PUT','inventory-items/'+first.id,data)
 expect(response.status).toBe(200)
 const saved=await response.json()
 expect(await (await request('PUT','inventory-items/'+first.id,data)).json()).toEqual(saved)
 expect((await request('PUT','inventory-items/'+first.id,{...data,menuPlan:{...data.menuPlan,requestId:crypto.randomUUID()}})).status).toBe(409)
})
it('batch直前の在庫/リンク更新はCASで409・全件置換の副作用なし',async()=>{
 const first=await create(),data=edit(first,[]),batch=env.DB.batch.bind(env.DB)
 const spy=vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
  await env.DB.prepare('UPDATE inventory_items SET price=456 WHERE id=?').bind(first.id).run()
  return batch(statements)
 })
 try {expect((await request('PUT','inventory-items/'+first.id,data)).status).toBe(409)} finally {spy.mockRestore()}
 expect((await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(first.id).all()).results).toHaveLength(2)
 expect(await env.DB.prepare('SELECT price FROM inventory_items WHERE id=?').bind(first.id).first()).toEqual({price:456})
})
it.each(['second original','success JSON'])('%s失敗で原本・在庫・link・週行・台帳全rollback',async failure=>{
 const before=await counts()
 const trigger=failure==='second original'
  ? "CREATE TRIGGER test_plan_failure BEFORE INSERT ON recipes WHEN NEW.title='[E2E_TEST] reject second' BEGIN SELECT RAISE(ABORT,'test plan original failure'); END"
  : "CREATE TRIGGER test_plan_failure BEFORE UPDATE OF response_json ON menu_operation_requests WHEN NEW.response_status=201 BEGIN SELECT RAISE(ABORT,'test plan final JSON failure'); END"
 await env.DB.exec(trigger)
 try {
  const response=await request('POST','inventory-items',body([{newRecipeTitle:'[E2E_TEST] first',remainingCount:1,memo:null,carryEnabled:false},{newRecipeTitle:'[E2E_TEST] reject second',remainingCount:1,memo:null,carryEnabled:false}]))
  expect(response.status).toBe(500)
  expect(await counts()).toEqual(before)
 } finally {await env.DB.exec('DROP TRIGGER test_plan_failure')}
})
it('旧個別link PATCHはplannedを409、数量下方とdailyONは400全未反映',async()=>{
 const first=await create(),link=first.menuLinks[0]
 expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:link.revision,usageQuantity:2,enabled:false,carryEnabled:false})).status).toBe(409)
 expect((await request('PATCH','inventory-items/'+first.id+'/quantity',{delta:-0.1})).status).toBe(400)
 expect((await request('PATCH','inventory-items/'+first.id,{...body(),dailyConsumption:1,autoConsumptionEnabled:true})).status).toBe(400)
 expect(await env.DB.prepare('SELECT quantity_tenths,auto_consumption_enabled FROM inventory_items WHERE id=?').bind(first.id).first()).toEqual({quantity_tenths:50,auto_consumption_enabled:0})
})
it('全stock writer用DB guardは直接下方更新を拒否し、リンク変更もaggregate revisionを更新する',async()=>{
 const first=await create()
 await expect(env.DB.prepare('UPDATE inventory_items SET quantity_tenths=49 WHERE id=?').bind(first.id).run()).rejects.toThrow('menu_plan_allocation')
 await env.DB.prepare('UPDATE inventory_menu_links SET memo=? WHERE id=?').bind('changed',first.menuLinks[0].id).run()
 expect((await request('PUT','inventory-items/'+first.id,edit(first))).status).toBe(409)
})

it.each([0.10000000001,1.00000000001])('新APIの小数値%sを黙って丸めず400で拒否する',async quantity=>{
 expect((await request('POST','inventory-items',{...body([]),quantity})).status).toBe(400)
})
it.each(['quantity','settings','shopping'] as const)('revision上限の旧%s APIは内部SQLを漏らさず409、全未反映',async endpoint=>{
 const item=await create({...body(),threshold:5})
 await env.DB.prepare('UPDATE inventory_items SET menu_plan_revision=9007199254740991 WHERE id=?').bind(item.id).run()
 const response=endpoint==='quantity'?await request('PATCH','inventory-items/'+item.id+'/quantity',{delta:1}):endpoint==='settings'?await request('PATCH','inventory-items/'+item.id,body()):await request('POST','shopping-list-items/update',{items:[{id:(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id=?').bind(item.id).first<{id:number}>())!.id,purchasedQuantity:1}]})
 expect(response.status).toBe(409)
 expect(await response.json()).toMatchObject({code:'RESOURCE_CONFLICT'})
 expect(await env.DB.prepare('SELECT quantity_tenths,price FROM inventory_items WHERE id=?').bind(item.id).first()).toEqual({quantity_tenths:50,price:123})
})
it('最終JSONが有効な別objectへ差し替わっても全未反映',async()=>{
 const before=await counts()
 await env.DB.prepare("CREATE TRIGGER test_plan_corrupt_snapshot AFTER UPDATE OF response_json ON menu_operation_requests WHEN NEW.response_status=201 BEGIN UPDATE menu_operation_requests SET response_json='{\"wrong\":true}' WHERE request_id=NEW.request_id; END").run()
 try {
  expect((await request('POST','inventory-items',body())).status).toBe(409)
  expect(await counts()).toEqual(before)
 } finally {await env.DB.exec('DROP TRIGGER test_plan_corrupt_snapshot')}
})
it('割当2+3→3+2の交換、stock減量+割当減量、増量+割当増量を同batchで確定する',async()=>{
 let item=await create()
 for(const [quantity,a,b] of [[5,3,2],[2,1,1],[7,3,4]]){
  const response=await request('PUT','inventory-items/'+item.id,{...edit(item,[{linkId:item.menuLinks[0].id,remainingCount:a,memo:null,carryEnabled:false},{linkId:item.menuLinks[1].id,remainingCount:b,memo:null,carryEnabled:true}]),quantity})
  expect(response.status).toBe(200)
  item=await response.json<Aggregate>()
  expect(item.quantity).toBe(quantity)
  expect(item.menuLinks.map(link=>link.remainingCount)).toEqual([a,b])
 }
})
it('batch直前に同UUIDで異bodyの成功が確定するとmismatchを返す',async()=>{
 const data=body(),other={...data,quantity:6},batch=env.DB.batch.bind(env.DB)
 const spy=vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
  expect((await request('POST','inventory-items',other)).status).toBe(201)
  return batch(statements)
 })
 let response:Response
 try {response=await request('POST','inventory-items',data)} finally {spy.mockRestore()}
 expect(response.status).toBe(409)
 expect(await response.json()).toMatchObject({code:'RESOURCE_CONFLICT',details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]})
 expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE household_id=?').bind(householdId).first()).toEqual({quantity_tenths:60})
})
it('在庫-1と全集合保存の真並行競合は常にstock/予約制約を保つ',async()=>{
 const item=await create({...body([line(2)]),quantity:5}),data={...edit(item),quantity:3}
 const responses=await Promise.all([request('PUT','inventory-items/'+item.id,data),request('PATCH','inventory-items/'+item.id+'/quantity',{delta:-1})])
 expect(responses[0].status).toBeOneOf([200,409])
 expect(responses[1].status).toBe(200)
 const row=(await env.DB.prepare('SELECT quantity_tenths,(SELECT SUM(remaining_count)*10 FROM inventory_menu_links WHERE inventory_item_id=inventory_items.id) AS allocated FROM inventory_items WHERE id=?').bind(item.id).first<{quantity_tenths:number;allocated:number}>())!
 expect(row.quantity_tenths).toBeGreaterThanOrEqual(row.allocated)
})
it('既存購入とdaily精算はaggregate revisionを無効化し、買い物syncにtrigger副作用を混ぜない',async()=>{
 const item=await create({...body([line(2)]),threshold:5}),shopping=(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id=?').bind(item.id).first<{id:number}>())!
 expect((await request('POST','shopping-list-items/update',{items:[{id:shopping.id,purchasedQuantity:1}]})).status).toBe(200)
 expect((await request('PUT','inventory-items/'+item.id,edit(item))).status).toBe(409)
 expect(await env.DB.prepare('SELECT id FROM shopping_list_items WHERE inventory_item_id=?').bind(item.id).first()).toBeNull()
 const ordinary=await (await request('POST','inventory-items',{...body(),name:'[E2E_TEST] ordinary daily',menuPlan:undefined,dailyConsumption:1,autoConsumptionEnabled:true})).json<{id:number}>()
 await env.DB.prepare("UPDATE inventory_items SET last_consumed_on='2026-01-01' WHERE id=?").bind(ordinary.id).run()
 const before=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(ordinary.id).first<{menu_plan_revision:number}>())!
 const {consumeInventoryForDate}=await import('../../lib/inventory-consumption')
 await consumeInventoryForDate(env.DB,'2026-01-02')
 expect((await request('PUT','inventory-items/'+ordinary.id,{...body([]),name:'[E2E_TEST] ordinary daily',expectedMenuPlanRevision:before.menu_plan_revision})).status).toBe(409)
})

it('旧link PATCHの事前read後にplannedへ変換されても週行とlinkを部分更新しない',async()=>{
 const legacy=await (await request('POST','inventory-items',{...body(),menuPlan:undefined,menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,usageQuantity:1,carryEnabled:false}]}})).json<{id:number}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(legacy.id).first<{id:number}>())!
 expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:0,usageQuantity:1,enabled:false,carryEnabled:false})).status).toBe(200)
 await env.DB.prepare('DELETE FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).run()
 const batch=env.DB.batch.bind(env.DB)
 let committed:unknown
 const spy=vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
  await env.DB.prepare('UPDATE inventory_menu_links SET remaining_count=2,enabled=1,revision=revision+1,memo=? WHERE id=?').bind('concurrent plan',link.id).run()
  committed={link:await env.DB.prepare('SELECT * FROM inventory_menu_links WHERE id=?').bind(link.id).first(),item:await env.DB.prepare('SELECT * FROM inventory_items WHERE id=?').bind(legacy.id).first()}
  return batch(statements)
 })
 try {expect((await request('PATCH','inventory-menu-links/'+link.id,{expectedRevision:1,usageQuantity:2,enabled:true,carryEnabled:false})).status).toBe(409)} finally {spy.mockRestore()}
 expect({link:await env.DB.prepare('SELECT * FROM inventory_menu_links WHERE id=?').bind(link.id).first(),item:await env.DB.prepare('SELECT * FROM inventory_items WHERE id=?').bind(legacy.id).first()}).toEqual(committed)
 expect((await env.DB.prepare('SELECT id FROM menu_entries WHERE inventory_menu_link_id=?').bind(link.id).all()).results).toEqual([])
})

it('I1: daily ON allocation requires explicit auto=false and keeps configured daily amount',async()=>{
 const ordinary=await (await request('POST','inventory-items',{...body(),menuPlan:undefined,dailyConsumption:1,autoConsumptionEnabled:true})).json<{id:number}>()
 const state=async()=>Promise.all(['inventory_items','recipes','inventory_menu_links','menu_entries','menu_operation_requests','shopping_list_items'].map(table=>env.DB.prepare('SELECT * FROM '+table+' WHERE household_id=? ORDER BY rowid').bind(householdId).all().then(result=>result.results)))
 const current=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(ordinary.id).first<{menu_plan_revision:number}>())!
 const data={...body([{newRecipeTitle:'[E2E_TEST] explicit off recipe',remainingCount:1,memo:null,carryEnabled:false}]),name:'[E2E_TEST] edited chicken',dailyConsumption:null,autoConsumptionEnabled:undefined,expectedMenuPlanRevision:current.menu_plan_revision}
 const before=await state()
 expect((await request('PUT','inventory-items/'+ordinary.id,data)).status).toBe(400)
 expect(await state()).toEqual(before)
 const response=await request('PUT','inventory-items/'+ordinary.id,{...data,autoConsumptionEnabled:false})
 expect(response.status).toBe(200)
 expect(await response.json()).toMatchObject({dailyConsumption:1,autoConsumptionEnabled:false,menuLinks:[{remainingCount:1}]})
 expect(await env.DB.prepare('SELECT daily_consumption_tenths,auto_consumption_enabled FROM inventory_items WHERE id=?').bind(ordinary.id).first()).toEqual({daily_consumption_tenths:10,auto_consumption_enabled:0})
})
it('I1: null clearing without a positive allocation retains the existing contract',async()=>{
 const ordinary=await (await request('POST','inventory-items',{...body(),menuPlan:undefined,dailyConsumption:1,autoConsumptionEnabled:true})).json<{id:number}>()
 const current=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(ordinary.id).first<{menu_plan_revision:number}>())!
 const response=await request('PUT','inventory-items/'+ordinary.id,{...body([]),dailyConsumption:null,autoConsumptionEnabled:undefined,expectedMenuPlanRevision:current.menu_plan_revision})
 expect(response.status).toBe(200)
 expect(await response.json()).toMatchObject({dailyConsumption:null,autoConsumptionEnabled:false,menuLinks:[]})
})
it('I2: legacy NULL to planned zero and daily ON is atomic and preserves historical snapshots',async()=>{
 const legacy=await (await request('POST','inventory-items',{...body(),menuPlan:undefined,menuLinkage:{requestId:crypto.randomUUID(),menus:[{recipeId,usageQuantity:1.5,carryEnabled:false}]}})).json<{id:number;linkedMenuEntries:{id:number}[]}>()
 const link=(await env.DB.prepare('SELECT id FROM inventory_menu_links WHERE inventory_item_id=?').bind(legacy.id).first<{id:number}>())!
 const entryId=legacy.linkedMenuEntries[0].id
 await env.DB.prepare("INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths) VALUES('testuser_i2_legacy_event',?,?,?,15)").bind(householdId,entryId,legacy.id).run()
 await env.DB.prepare("UPDATE menu_entries SET meal_state='eaten',meal_revision=1,consumed_event_id='testuser_i2_legacy_event' WHERE id=?").bind(entryId).run()
 const oldEntries=(await env.DB.prepare('SELECT * FROM menu_entries WHERE household_id=? ORDER BY id').bind(householdId).all()).results
 const oldEvents=(await env.DB.prepare('SELECT * FROM menu_consumption_events WHERE household_id=? ORDER BY id').bind(householdId).all()).results
 const oldRecipe=await env.DB.prepare('SELECT * FROM recipes WHERE id=?').bind(recipeId).first()
 const current=(await env.DB.prepare('SELECT menu_plan_revision FROM inventory_items WHERE id=?').bind(legacy.id).first<{menu_plan_revision:number}>())!
 const response=await request('PUT','inventory-items/'+legacy.id,{...body([{linkId:link.id,remainingCount:0,memo:'[E2E_TEST] retained',carryEnabled:false}]),dailyConsumption:1,autoConsumptionEnabled:true,expectedMenuPlanRevision:current.menu_plan_revision})
 expect(response.status).toBe(200)
 expect(await response.json()).toMatchObject({quantity:5,dailyConsumption:1,autoConsumptionEnabled:true,menuLinks:[{id:link.id,remainingCount:0,usageQuantity:1.5}]})
 expect(await env.DB.prepare('SELECT remaining_count,usage_tenths FROM inventory_menu_links WHERE id=?').bind(link.id).first()).toEqual({remaining_count:0,usage_tenths:15})
 expect((await env.DB.prepare('SELECT * FROM menu_entries WHERE household_id=? ORDER BY id').bind(householdId).all()).results).toEqual(oldEntries)
 expect((await env.DB.prepare('SELECT * FROM menu_consumption_events WHERE household_id=? ORDER BY id').bind(householdId).all()).results).toEqual(oldEvents)
 expect(await env.DB.prepare('SELECT * FROM recipes WHERE id=?').bind(recipeId).first()).toEqual(oldRecipe)
})
