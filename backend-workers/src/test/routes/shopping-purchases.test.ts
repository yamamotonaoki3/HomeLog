import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { consumeInventoryForDate } from '../../lib/inventory-consumption'

let headers: Record<string, string>
const uuid = (n = 1) => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`
type Line = { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }
const line = (id = 1, purchasedQuantity = 1, expectedPurchaseRevision = 0): Line => ({ id, purchasedQuantity, expectedPurchaseRevision })
const body = (items = [line()], key = 1) => ({ requestId: uuid(key), items })
const purchase = (payload = body(), bindings = env) => app.request('/api/shopping-list-items/purchases', { method: 'POST', headers, body: JSON.stringify(payload) }, bindings)
const patch = (id: number, plannedQuantity: number, expectedPurchaseRevision = 0) => app.request(`/api/shopping-list-items/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ plannedQuantity, expectedPurchaseRevision }) }, env)
const snapshot = async () => ({
  inventory: (await env.DB.prepare('SELECT * FROM inventory_items ORDER BY id').all()).results,
  shopping: (await env.DB.prepare('SELECT * FROM shopping_list_items ORDER BY id').all()).results,
})
const ledger = async () => (await env.DB.prepare('SELECT * FROM shopping_purchase_requests').all()).results
const stock = () => env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=1').first<{ quantity_tenths: number }>()
function proxyDb(intercept: (sql: string, run: () => Promise<unknown>) => Promise<unknown>, batchIntercept?: (run: () => Promise<D1Result[]>) => Promise<D1Result[]>) {
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args: unknown[]) => wrap(target.bind(...args), sql)
      if (['first', 'all', 'run', 'raw'].includes(String(key))) return (...args: unknown[]) => intercept(sql, () => (Reflect.get(target, key) as (...a: unknown[]) => Promise<unknown>).apply(target, args))
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    return wrapped
  }
  const DB = new Proxy(env.DB, { get(target, key) {
    if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql)
    if (key === 'batch') return (statements: D1PreparedStatement[]) => {
      // D1 RPC accepts the wrapped prepared statements just like the real ones.
      const run = () => target.batch(statements)
      return batchIntercept ? batchIntercept(run) : run()
    }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return { ...env, DB }
}
beforeEach(async () => {
  await env.DB.batch(['shopping_purchase_requests','shopping_list_items','inventory_items','stores','zaiko_categories','household_members','households','users'].map(table => env.DB.prepare(`DELETE FROM ${table}`)))
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,email,password_hash,display_name) VALUES (1,'testuser_455@example.com','dummy','[E2E_TEST] actor'),(2,'testuser_455_other@example.com','dummy','[E2E_TEST] other')"),
    env.DB.prepare("INSERT INTO households (id,name,invite_code) VALUES (1,'[E2E_TEST] household','testuser_455'),(2,'[E2E_TEST] other','testuser_455other')"),
    env.DB.prepare('INSERT INTO household_members (household_id,user_id) VALUES (1,1),(1,2)'),
    env.DB.prepare("INSERT INTO zaiko_categories (id,household_id,name) VALUES (1,1,'[E2E_TEST] category')"),
    env.DB.prepare("INSERT INTO inventory_items (id,household_id,name,category_id,quantity_tenths,threshold_tenths,price) VALUES (1,1,'[E2E_TEST] item1',1,0,10,123),(2,1,'[E2E_TEST] item2',1,0,50,NULL),(3,1,'[E2E_TEST] item3',1,100,0,456)"),
    env.DB.prepare('INSERT INTO shopping_list_items (id,household_id,inventory_item_id,is_manual) VALUES (1,1,1,0),(2,1,2,0),(3,1,3,1)'),
  ])
  headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${await signAccessToken(1, env.JWT_SECRET, 900)}` }
})

it('SQL: partial, complete and excess purchases return ordered committed snapshots; zeros are unchanged', async () => {
  await env.DB.prepare('UPDATE shopping_list_items SET planned_quantity_tenths=30 WHERE id=1').run()
  const untouched = await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=2').first()
  const res = await purchase(body([line(3,4),line(1,2),line(2,0)]))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ requestId: uuid(), updatedInventoryItems: [{ id:3, quantity:14 },{ id:1, quantity:2 }], removedShoppingListItemIds:[3], remainingShoppingListItems:[{ id:1,plannedQuantity:1,purchaseRevision:1 }] })
  expect(await env.DB.prepare('SELECT planned_quantity_tenths,planned_quantity_explicit,purchase_revision,purchased,purchased_quantity_tenths FROM shopping_list_items WHERE id=1').first()).toEqual({ planned_quantity_tenths:10,planned_quantity_explicit:1,purchase_revision:1,purchased:0,purchased_quantity_tenths:0 })
  expect(await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=2').first()).toEqual(untouched)
  expect((await ledger()).length).toBe(1)
})
it('SQL: all zero is a successful empty snapshot; auto fully bought at/below threshold resets to next one', async () => {
  const before = await snapshot()
  const zero = await purchase(body([line(1,0),line(3,0)]))
  expect(zero.status).toBe(200)
  expect(await zero.json()).toEqual({requestId:uuid(),updatedInventoryItems:[],removedShoppingListItemIds:[],remainingShoppingListItems:[]})
  expect(await snapshot()).toEqual(before)
  const res = await purchase(body([line(1),line(2)],2))
  expect(res.status).toBe(200)
  expect((await res.json<{remainingShoppingListItems:unknown[]}>()).remainingShoppingListItems).toEqual([{id:1,plannedQuantity:1,purchaseRevision:1},{id:2,plannedQuantity:1,purchaseRevision:1}])
})
it('SQL: real named guard failure rolls back inventory and records immutable terminal conflict', async () => {
  const before = await snapshot()
  let fired=false
  const bindings=proxyDb((_sql,run)=>run(),async run=>{ if(!fired){fired=true;await env.DB.prepare('UPDATE shopping_list_items SET purchase_revision=1 WHERE id=2').run()} return run() })
  const res=await purchase(body([line(1),line(2)]),bindings)
  expect(res.status).toBe(409)
  expect(await res.json()).toMatchObject({code:'RESOURCE_CONFLICT',details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
  expect((await snapshot()).inventory).toEqual(before.inventory)
  expect((await ledger()).length).toBe(1)
  await env.DB.prepare('UPDATE shopping_list_items SET purchase_revision=0 WHERE id=2').run()
  expect((await purchase(body([line(1),line(2)]))).status).toBe(409)
})
for(const trigger of [
  "CREATE TRIGGER test_455_abort BEFORE DELETE ON shopping_list_items BEGIN SELECT RAISE(ABORT,'test_455_unknown'); END",
  "CREATE TRIGGER test_455_abort BEFORE UPDATE OF planned_quantity_tenths ON shopping_list_items BEGIN SELECT RAISE(ABORT,'test_455_unknown'); END",
  "CREATE TRIGGER test_455_abort BEFORE UPDATE OF response_json ON shopping_purchase_requests BEGIN SELECT RAISE(ABORT,'test_455_unknown'); END",
  "CREATE TRIGGER test_455_abort BEFORE UPDATE OF response_json ON shopping_purchase_requests BEGIN SELECT RAISE(IGNORE); END",
  "CREATE TRIGGER test_455_abort AFTER UPDATE OF response_json ON shopping_purchase_requests BEGIN UPDATE shopping_purchase_requests SET response_json=NULL WHERE request_id=NEW.request_id; END",
  "CREATE TRIGGER test_455_abort AFTER UPDATE OF response_json ON shopping_purchase_requests BEGIN UPDATE shopping_purchase_requests SET response_json='{}' WHERE request_id=NEW.request_id; END",
  "CREATE TRIGGER test_455_abort AFTER UPDATE OF response_json ON shopping_purchase_requests BEGIN DELETE FROM shopping_purchase_requests WHERE request_id=NEW.request_id; END",
]) it(`SQL: downstream exception or invalid final snapshot rolls back every write (${trigger.slice(0,85)})`,async()=>{
  const before=await snapshot()
  await env.DB.exec(trigger)
  try{expect((await purchase(body([line(3,1),line(1,0.1)]))).status).toBe(500);expect(await snapshot()).toEqual(before);expect(await ledger()).toEqual([])}finally{await env.DB.exec('DROP TRIGGER test_455_abort')}
})
it('SQL: success wins against guard rejection INSERT and both callers return the same snapshot',async()=>{
  let fired=false
  const bindings=proxyDb(async(sql,run)=>{
    if(sql.includes('INSERT INTO shopping_purchase_requests')&&sql.includes('WHERE EXISTS')&&!fired){fired=true;await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=1').run();const winner=await purchase();expect(winner.status).toBe(200)}
    return run()
  },async run=>{
    if(!fired)await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=1').run()
    return run()
  })
  const res=await purchase(body(),bindings)
  expect(res.status).toBe(200)
  expect(fired).toBe(true)
  expect(await res.json()).toEqual(await (await purchase()).json())
  expect(await stock()).toEqual({quantity_tenths:10})
  expect((await ledger()).length).toBe(1)
})
it('SQL: rejection wins before a queued same-key purchase and stays rejected after a new-key success',async()=>{
  let release!:()=>void;let entered!:()=>void
  const ready=new Promise<void>(resolve=>{entered=resolve});const gate=new Promise<void>(resolve=>{release=resolve})
  const bindings=proxyDb((_sql,run)=>run(),async run=>{entered();await gate;return run()})
  const queued=purchase(body(),bindings);await ready
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=1').run()
  const rejected=await purchase();expect(rejected.status).toBe(400)
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=1').run()
  expect((await purchase(body([line()],2))).status).toBe(200)
  release()
  const delayed=await queued;expect(delayed.status).toBe(400);expect(await delayed.json()).toEqual(await rejected.json())
  expect((await purchase()).status).toBe(400);expect(await stock()).toEqual({quantity_tenths:10});expect((await ledger()).length).toBe(2)
})

it('GET and manual POST expose default plan and revision; PATCH uses CAS even for same-value saves',async()=>{
  const get=await app.request('/api/shopping-list-items',{headers},env)
  expect((await get.json<{id:number;plannedQuantity:number;purchaseRevision:number}[]>()).find(e=>e.id===1)).toMatchObject({plannedQuantity:1,purchaseRevision:0})
  const before=await stock()
  for(const [quantity,revision] of [[1,0],[0.1,1],[99999.9,2]]){
    const res=await patch(1,quantity,revision)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({id:1,plannedQuantity:quantity,purchaseRevision:revision+1})
  }
  expect(await stock()).toEqual(before)
  expect((await patch(1,3,0)).status).toBe(409)
  expect((await patch(999,1)).status).toBe(404)
  for(const quantity of [0,-1,0.01,999999,NaN])expect((await patch(1,quantity,3)).status).toBe(400)
  expect(await env.DB.prepare('SELECT planned_quantity_explicit FROM shopping_list_items WHERE id=1').first()).toEqual({planned_quantity_explicit:1})
  await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=3').run()
  const post=await app.request('/api/shopping-list-items',{method:'POST',headers,body:JSON.stringify({inventoryItemId:3})},env)
  expect(post.status).toBe(201);expect(await post.json()).toMatchObject({plannedQuantity:1,purchaseRevision:0,price:456})
})
it('planned residual survives inventory quantity/threshold edits and Cron without overwriting revisions',async()=>{
  await patch(1,3)
  expect((await purchase(body([line(1,2,1)]))).status).toBe(200)
  const entry=await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=1').first()
  for(const payload of [{delta:1},{name:'[E2E_TEST] item1',categoryId:1,storeId:null,threshold:0}]){
    const path='delta' in payload?'/api/inventory-items/1/quantity':'/api/inventory-items/1'
    expect((await app.request(path,{method:'PATCH',headers,body:JSON.stringify(payload)},env)).status).toBe(200)
    expect(await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=1').first()).toEqual(entry)
  }
  await env.DB.prepare("UPDATE inventory_items SET daily_consumption_tenths=1,auto_consumption_enabled=1,last_consumed_on='2099-01-01' WHERE id=1").run()
  await consumeInventoryForDate(env.DB,'2099-01-02')
  expect(await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=1').first()).toEqual(entry)
})
it('legacy update rejects protected mixed requests and a PATCH racing after its initial read',async()=>{
  await patch(1,1)
  const before=await snapshot()
  const payload={items:[{id:1,purchasedQuantity:1},{id:2,purchasedQuantity:1}]}
  const old=()=>app.request('/api/shopping-list-items/update',{method:'POST',headers,body:JSON.stringify(payload)},env)
  expect((await old()).status).toBe(409);expect(await snapshot()).toEqual(before)
  await env.DB.prepare('UPDATE shopping_list_items SET planned_quantity_explicit=0 WHERE id=1').run()
  let fired=false;let after:Awaited<ReturnType<typeof snapshot>>
  const bindings=proxyDb((_sql,run)=>run(),async run=>{if(!fired){fired=true;expect((await patch(1,1,1)).status).toBe(200);after=await snapshot()}return run()})
  const race=await app.request('/api/shopping-list-items/update',{method:'POST',headers,body:JSON.stringify(payload)},bindings)
  expect(race.status).toBe(409);expect(await snapshot()).toEqual(after!)
})

it('revision increment refuses unsafe successor but zero purchase remains a no-op',async()=>{
  await env.DB.prepare('UPDATE shopping_list_items SET purchase_revision=? WHERE id=1').bind(Number.MAX_SAFE_INTEGER).run()
  const before=await snapshot()
  expect((await patch(1,2,Number.MAX_SAFE_INTEGER)).status).toBe(409)
  expect(await snapshot()).toEqual(before)
  const res=await purchase(body([line(1,0.1,Number.MAX_SAFE_INTEGER)]))
  expect(res.status).toBe(409)
  expect(await res.json()).toMatchObject({details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
  expect(await snapshot()).toEqual(before)
  expect((await purchase(body([line(1,0,Number.MAX_SAFE_INTEGER)],2))).status).toBe(200)
  expect(await snapshot()).toEqual(before)
})

it('same-key sequential and concurrent replay returns one snapshot before mutable row checks',async()=>{
  const payload=body([line(3,0.1),line(1,0.1)])
  const results=await Promise.all([purchase(payload),purchase(payload)])
  expect(results.map(r=>r.status)).toEqual([200,200])
  const first=await results[0].json();expect(await results[1].json()).toEqual(first)
  expect(await stock()).toEqual({quantity_tenths:1});expect((await ledger()).length).toBe(1)
  await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=1').run()
  await env.DB.prepare('INSERT INTO shopping_list_items (household_id,inventory_item_id,is_manual) VALUES (1,1,1)').run()
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=9 WHERE id=1').run()
  expect(await (await purchase(payload)).json()).toEqual(first)
  expect(await stock()).toEqual({quantity_tenths:9})
  const mismatch=await purchase(body([line(1,0.1),line(3,0.1)]))
  expect(mismatch.status).toBe(409);expect(await mismatch.json()).toMatchObject({code:'SHOPPING_PURCHASE_REQUEST_MISMATCH',details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]})
})
it('normalization keeps raw quantities distinct but ignores UUID casing and JSON field order',async()=>{
  const payload=body([line(1,0.1)])
  const first=await purchase(payload);expect(first.status).toBe(200)
  const same=await purchase({items:[{expectedPurchaseRevision:0,purchasedQuantity:0.10,id:1}],requestId:uuid().toUpperCase()})
  expect(same.status).toBe(200);expect(await same.json()).toEqual(await first.json())
  expect((await purchase(body([line(1,0.11)]))).status).toBe(409)
  const invalidCases=[[],[line(1,0.11)],[line(1,-1)],[line(1,100000)],[line(0)],[line(1,1,-1)],[line(),line()]]
  for(const [index,invalid] of invalidCases.entries()){
    const res=await purchase(body(invalid,10+index))
    expect(res.status).toBe(400)
  }
  const before=(await ledger()).length
  for(const invalid of [{requestId:'bad',items:[line()]},{requestId:uuid(30),items:[{id:1,purchasedQuantity:'1',expectedPurchaseRevision:0}]},{requestId:uuid(31),items:[line(Number.MAX_SAFE_INTEGER+1)]}]){
    const res=await app.request('/api/shopping-list-items/purchases',{method:'POST',headers,body:JSON.stringify(invalid)},env)
    expect(res.status).toBe(400);expect(await res.json()).toMatchObject({details:[]})
  }
  expect((await ledger()).length).toBe(before)
})
it('terminal 400 and 404 persist after conditions change and altered bodies mismatch',async()=>{
  for(const [key,items] of [[10,[line(1,0.01)]],[11,[line(99)]]] as const){
    const payload=body([...items],key)
    const first=await purchase(payload);expect(first.status).toBe(key===10?400:404)
    const error=await first.json();expect(error).toMatchObject({details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
    if(key===11){await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=3').run();await env.DB.prepare('INSERT INTO shopping_list_items (id,household_id,inventory_item_id,is_manual) VALUES (99,1,3,1)').run()}
    const repeated=await purchase(payload);expect(repeated.status).toBe(first.status);expect(await repeated.json()).toEqual(error)
    const mismatch=await purchase(body([line(2)],key));expect(mismatch.status).toBe(409);expect(await mismatch.json()).toMatchObject({code:'SHOPPING_PURCHASE_REQUEST_MISMATCH'})
  }
})
for(const candidate of ['upper','missing'] as const)it(`terminal ${candidate} precheck rejection loses a real INSERT UNIQUE race to a committed purchase`,async()=>{
  if(candidate==='upper')await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=1').run()
  else await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=1').run()
  let fired=false
  const bindings=proxyDb(async(sql,run)=>{
    if(sql.includes('INSERT INTO shopping_purchase_requests')&&sql.includes('WHERE EXISTS')&&!fired){
      fired=true
      if(candidate==='upper')await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=1').run()
      else await env.DB.prepare('INSERT INTO shopping_list_items (id,household_id,inventory_item_id,is_manual) VALUES (1,1,1,0)').run()
      expect((await purchase()).status).toBe(200)
    }
    return run()
  })
  const res=await purchase(body(),bindings);expect(fired).toBe(true);expect(res.status).toBe(200)
  expect(await res.json()).toEqual(await (await purchase()).json());expect(await stock()).toEqual({quantity_tenths:10});expect((await ledger()).length).toBe(1)
})
it('guard rejection wins, then queued old purchase cannot turn successful after corrected stock and new key',async()=>{
  let release!:()=>void;let entered!:()=>void
  const ready=new Promise<void>(r=>{entered=r});const gate=new Promise<void>(r=>{release=r})
  const queued=purchase(body(),proxyDb((_sql,run)=>run(),async run=>{entered();await gate;return run()}));await ready
  let fired=false
  const rejected=await purchase(body(),proxyDb((_sql,run)=>run(),async run=>{if(!fired){fired=true;await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=1').run()}return run()}))
  expect(rejected.status).toBe(409);const error=await rejected.json()
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=1').run()
  expect((await purchase(body([line()],2))).status).toBe(200)
  release();const old=await queued;expect(old.status).toBe(409);expect(await old.json()).toEqual(error)
  expect(await (await purchase()).json()).toEqual(error);expect(await stock()).toEqual({quantity_tenths:10})
})
for(const after of [false,true])it(`rejection INSERT transport failure ${after?'after':'before'} commit is unknown until same-key recovery`,async()=>{
  let fired=false
  const bindings=proxyDb(async(sql,run)=>{
    if(sql.includes('INSERT INTO shopping_purchase_requests')&&sql.includes('WHERE EXISTS')&&!fired){fired=true;if(after)await run();throw new Error('[E2E_TEST] response lost')}
    return run()
  })
  const payload=body([line(99)])
  expect((await purchase(payload,bindings)).status).toBe(500);expect((await ledger()).length).toBe(after?1:0)
  const recovered=await purchase(payload);expect(recovered.status).toBe(404);expect(await recovered.json()).toMatchObject({details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
})
it('successful commit followed by transport failure recovers saved snapshot without extra stock',async()=>{
  const bindings=proxyDb((_sql,run)=>run(),async run=>{await run();throw new Error('[E2E_TEST] committed response lost')})
  expect((await purchase(body(),bindings)).status).toBe(500)
  const recover=await purchase();expect(recover.status).toBe(200);expect(await stock()).toEqual({quantity_tenths:10});expect((await ledger()).length).toBe(1)
})
for(const corrupt of [null,'not-json','{}',JSON.stringify({requestId:uuid(),updatedInventoryItems:[],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:1,plannedQuantity:-1,purchaseRevision:0}]}),JSON.stringify({requestId:uuid(),updatedInventoryItems:[{id:1,quantity:1}],removedShoppingListItemIds:[],remainingShoppingListItems:[{id:99,plannedQuantity:1,purchaseRevision:1}]})])it(`corrupt committed ledger is 500 and never repaired or purchased (${corrupt})`,async()=>{
  await env.DB.prepare('INSERT INTO shopping_purchase_requests (household_id,actor_user_id,request_id,request_json,response_status,response_json) VALUES (1,1,?,?,200,?)').bind(uuid(),JSON.stringify({version:1,items:[line()]}),corrupt).run()
  const before=await snapshot();const old=await ledger()
  expect((await purchase()).status).toBe(500);expect(await snapshot()).toEqual(before);expect(await ledger()).toEqual(old)
})
it('actor and household scopes never reuse another actor result, and lost membership has no terminal marker',async()=>{
  expect((await purchase()).status).toBe(200)
  const actor1=headers;headers={...headers,Authorization:`Bearer ${await signAccessToken(2,env.JWT_SECRET,900)}`}
  const other=await purchase();expect(other.status).toBe(409);expect(await other.json()).toMatchObject({code:'RESOURCE_CONFLICT'})
  headers=actor1
  await env.DB.prepare('UPDATE household_members SET household_id=2 WHERE user_id=1').run()
  const moved=await purchase();expect(moved.status).toBe(404);expect(await moved.json()).toMatchObject({code:'RESOURCE_NOT_FOUND',details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
  await env.DB.prepare('DELETE FROM household_members WHERE user_id=1').run()
  const gone=await purchase();expect(gone.status).toBe(404);expect(await gone.json()).toMatchObject({details:[]})
  headers={'Content-Type':'application/json'};expect((await purchase()).status).toBe(401)
})
it('scope disappearing immediately before terminal rejection INSERT produces no marker or terminal record',async()=>{
  const bindings=proxyDb(async(sql,run)=>{if(sql.includes('INSERT INTO shopping_purchase_requests')&&sql.includes('WHERE EXISTS'))await env.DB.prepare('DELETE FROM household_members WHERE user_id=1').run();return run()})
  const res=await purchase(body([line(99)]),bindings)
  expect(res.status).toBe(404);expect(await res.json()).toMatchObject({details:[]});expect(await ledger()).toEqual([])
})
for(const position of [1,2,3])for(const race of ['list-delete','stock-delete','plan','purchase','upper'] as const)it(`all-or-nothing: ${race} in position ${position} leaves every other item unchanged`,async()=>{
  let fired=false;let after:Awaited<ReturnType<typeof snapshot>>
  const bindings=proxyDb((_sql,run)=>run(),async run=>{
    if(!fired){fired=true
      if(race==='list-delete')await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=?').bind(position).run()
      if(race==='stock-delete')await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(position).run()
      if(race==='plan')expect((await patch(position,3)).status).toBe(200)
      if(race==='purchase')expect((await purchase(body([line(position,0.1)],90))).status).toBe(200)
      if(race==='upper')await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999999 WHERE id=?').bind(position).run()
      after=await snapshot()
    }
    return run()
  })
  const res=await purchase(body([line(1,0.1),line(2,0.1),line(3,0.1)]),bindings)
  expect(res.status).toBe(409);expect(await snapshot()).toEqual(after!)
  expect((await ledger()).length).toBe(race==='purchase'?2:1)
})
it('different keys with same revision have exactly one winner, and decimal stock upper bound is exact',async()=>{
  const results=await Promise.all([purchase(body([line(1,0.1)],1)),purchase(body([line(1,0.1)],2))])
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await stock()).toEqual({quantity_tenths:1})
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=999998 WHERE id=1').run()
  expect((await purchase(body([line(1,0.1,1)],3))).status).toBe(200)
  expect(await stock()).toEqual({quantity_tenths:999999})
  expect((await purchase(body([line(1,0.2,2)],4))).status).toBe(400)
})

it('a missing-row terminal 404 wins against an already queued successful candidate even after row restoration',async()=>{
  let release!:()=>void;let entered!:()=>void
  const ready=new Promise<void>(r=>{entered=r});const gate=new Promise<void>(r=>{release=r})
  const queued=purchase(body(),proxyDb((_sql,run)=>run(),async run=>{entered();await gate;return run()}));await ready
  await env.DB.prepare('DELETE FROM shopping_list_items WHERE id=1').run()
  const rejected=await purchase();expect(rejected.status).toBe(404);const error=await rejected.json()
  await env.DB.prepare('INSERT INTO shopping_list_items (id,household_id,inventory_item_id,is_manual) VALUES (1,1,1,0)').run()
  release();const old=await queued;expect(old.status).toBe(404);expect(await old.json()).toEqual(error)
  expect(await stock()).toEqual({quantity_tenths:0});expect((await ledger()).length).toBe(1)
})
it('different bodies competing at the real rejection INSERT preserve one terminal rejection and return mismatch to the loser',async()=>{
  let fired=false
  const bindings=proxyDb(async(sql,run)=>{
    if(sql.includes('INSERT INTO shopping_purchase_requests')&&sql.includes('WHERE EXISTS')&&!fired){fired=true;const winner=await purchase(body([line(1,0.01)]));expect(winner.status).toBe(400)}
    return run()
  })
  const loser=await purchase(body([line(99)]),bindings)
  expect(loser.status).toBe(409);expect(await loser.json()).toMatchObject({code:'SHOPPING_PURCHASE_REQUEST_MISMATCH'})
  expect((await ledger()).length).toBe(1)
  const replay=await purchase(body([line(1,0.01)]));expect(replay.status).toBe(400)
  expect(await replay.json()).toMatchObject({details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]})
})
it('partial auto plan can be completed later and stale plan PATCH never restores its old residual',async()=>{
  expect((await patch(1,3)).status).toBe(200)
  expect((await purchase(body([line(1,2,1)]))).status).toBe(200)
  expect((await patch(1,3,1)).status).toBe(409)
  expect((await purchase(body([line(1,1,2)],2))).status).toBe(200)
  expect(await env.DB.prepare('SELECT * FROM shopping_list_items WHERE id=1').first()).toBeNull()
  expect(await stock()).toEqual({quantity_tenths:30})
})
it('zero lines still check live membership in the purchase batch and cannot leave a marker after exit',async()=>{
  const before=await snapshot()
  const bindings=proxyDb((_sql,run)=>run(),async run=>{await env.DB.prepare('DELETE FROM household_members WHERE user_id=1').run();return run()})
  const res=await purchase(body([line(1,0)]),bindings)
  expect(res.status).toBe(404);expect(await res.json()).toMatchObject({details:[]})
  expect(await snapshot()).toEqual(before);expect(await ledger()).toEqual([])
})
