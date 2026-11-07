import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { DashboardDayDetail } from '../../lib/dashboard-day-detail'

let sequence = 0
async function id(sql: string, ...args: (string | number | null)[]): Promise<number> {
  const row = await env.DB.prepare(sql + ' RETURNING id').bind(...args).first<{ id: number }>()
  if (!row) throw new Error('fixture error')
  return row.id
}
async function actor(householdId?: number) {
  const userId = await id('INSERT INTO users(email,password_hash,display_name) VALUES(?,?,?)', 'testuser_day_' + ++sequence + '@example.com', 'dummy', 'testuser_day')
  const ownHousehold = householdId ?? await id('INSERT INTO households(name,invite_code) VALUES(?,?)', '[E2E_TEST] day', 'DAY' + sequence.toString().padStart(13, '0'))
  await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)').bind(ownHousehold,userId).run()
  const headers = { Authorization: 'Bearer ' + await signAccessToken(userId, env.JWT_SECRET, 900) }
  return { userId, householdId: ownHousehold, headers }
}
type Actor = Awaited<ReturnType<typeof actor>>
const get = (who: Actor, date = '2026-11-05') => app.request('/api/dashboard/day-detail?date=' + date, { headers: who.headers }, env)
const detail = async (who: Actor, date = '2026-11-05') => {
  const response = await get(who, date)
  expect(response.status).toBe(200)
  return response.json<DashboardDayDetail>()
}
async function cost(who: Actor, overrides: { owner?: number | null; day?: number; amount?: number; effective?: string | null; created?: string } = {}) {
  return id('INSERT INTO fixed_costs(household_id,created_by_user_id,owner_user_id,name,amount,payment_day,effective_from,created_at) VALUES(?,?,?,?,?,?,?,?)',
    who.householdId, who.userId, overrides.owner ?? null, '[E2E_TEST] cost', overrides.amount ?? 80000, overrides.day ?? 5, overrides.effective === undefined ? '2026-10-01' : overrides.effective, overrides.created ?? '2026-10-01 00:00:00')
}
async function expense(who: Actor, amount = 2000, fixedCostId: number | null = null, date = '2026-11-05', month: string | null = fixedCostId ? '2026-11' : null) {
  const categoryId = await id('INSERT INTO kakeibo_categories(household_id,name,is_default) VALUES(?,?,0)', who.householdId, '[E2E_TEST] expense')
  return id('INSERT INTO expenses(household_id,payer_user_id,category_id,amount,purpose,expense_date,fixed_cost_id,fixed_cost_year_month) VALUES(?,?,?,?,?,?,?,?)',
    who.householdId, who.userId, categoryId, amount, '[E2E_TEST] expense', date, fixedCostId, month)
}
async function income(who: Actor, amount = 100000) {
  const categoryId = await id('INSERT INTO income_categories(household_id,name,is_default) VALUES(?,?,0)', who.householdId, '[E2E_TEST] income')
  return id('INSERT INTO incomes(household_id,earner_user_id,category_id,amount,content,income_date) VALUES(?,?,?,?,?,?)', who.householdId,who.userId,categoryId,amount,'[E2E_TEST] income','2026-11-05')
}
async function event(who: Actor, owner: number | null, recurrence = 'none', date = '2026-11-05') {
  return id('INSERT INTO events(household_id,created_by_user_id,owner_user_id,name,event_date,recurrence_type) VALUES(?,?,?,?,?,?)', who.householdId,who.userId,owner,'[E2E_TEST] event',date,recurrence)
}
async function suppress(fixedCostId: number, month = '2026-11') {
  await env.DB.prepare('INSERT INTO fixed_cost_posting_suppressions(fixed_cost_id,year_month) VALUES(?,?)').bind(fixedCostId,month).run()
}

describe('GET /api/dashboard/day-detail', () => {
  it('空日も完全な型で返し、選択日の月曜週を使う', async () => {
    const who = await actor()
    expect(await detail(who)).toEqual({ date: '2026-11-05', weekStartDate: '2026-11-02', menuEntries: [], events: [], finance: { income: 0, expense: 0, balance: 0, incomes: [], expenses: [] }, fixedCosts: [] })
  })
  it.each(['', '2026-02-30', '2026-13-01', '2026-1-05', 'no-date'])('不正日付 %s は400', async (date) => {
    const who = await actor()
    const response = await get(who,date)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it('欠落日付は400、未認証は401、世帯なしは404', async () => {
    const who = await actor()
    expect((await app.request('/api/dashboard/day-detail', { headers: who.headers }, env)).status).toBe(400)
    expect((await app.request('/api/dashboard/day-detail?date=2026-11-05', {}, env)).status).toBe(401)
    await env.DB.prepare('DELETE FROM household_members WHERE user_id=?').bind(who.userId).run()
    expect((await get(who)).status).toBe(404)
  })
  it('本人実績だけをid降順で返し、固定費予定額を二重加算しない', async () => {
    const who = await actor(), other = await actor(who.householdId), outsider = await actor()
    const fixedCostId = await cost(who)
    const postedId = await expense(who,80000,fixedCostId)
    const normalId = await expense(who)
    const incomeId = await income(who)
    await expense(other,900000)
    await income(other,900000)
    await expense(outsider,900000)
    await income(outsider,900000)
    const body = await detail(who)
    expect(body.finance).toEqual({ income: 100000, expense: 82000, balance: 18000,
      incomes: [{ id: incomeId, incomeDate: '2026-11-05', amount: 100000, content: '[E2E_TEST] income' }],
      expenses: [{ id: normalId, expenseDate: '2026-11-05', amount: 2000, purpose: '[E2E_TEST] expense', fixedCostId: null, fixedCostYearMonth: null }, { id: postedId, expenseDate: '2026-11-05', amount: 80000, purpose: '[E2E_TEST] expense', fixedCostId, fixedCostYearMonth: '2026-11' }] })
    expect(body.fixedCosts).toEqual([{ id: fixedCostId, name: '[E2E_TEST] cost', amount: 80000, paymentDate: '2026-11-05', yearMonth: '2026-11', postingStatus: 'posted', postedExpense: { id: postedId, expenseDate: '2026-11-05', amount: 80000 } }])
  })
  it('収支差額0円でも実績配列と件数の根拠を失わない', async () => {
    const who=await actor()
    await expense(who,2000); await income(who,2000)
    const body=await detail(who)
    expect(body.finance.balance).toBe(0)
    expect(body.finance.incomes).toHaveLength(1)
    expect(body.finance.expenses).toHaveLength(1)
  })
  it('同世帯の共有/本人イベントと固定費だけを返す', async () => {
    const who = await actor(), other = await actor(who.householdId), outsider = await actor()
    const ownEvent = await event(who,who.userId), sharedEvent = await event(other,null,'daily','2026-11-01')
    await event(other,other.userId); await event(outsider,null)
    const ownCost = await cost(who,{owner:who.userId}), sharedCost = await cost(other)
    await cost(other,{owner:other.userId}); await cost(outsider)
    const body = await detail(who)
    expect(body.events).toEqual([{id:ownEvent,name:'[E2E_TEST] event',eventDate:'2026-11-05',recurrenceType:'none',isRecurring:false},{id:sharedEvent,name:'[E2E_TEST] event',eventDate:'2026-11-01',recurrenceType:'daily',isRecurring:true}])
    expect(body.fixedCosts.map(row=>row.id)).toEqual([ownCost,sharedCost])
  })
  it('共有他者の支出/抑止の存在で応答・件数・実額を変えない', async () => {
    const who = await actor(), other = await actor(who.householdId)
    const fixedCostId = await cost(other)
    const before = await detail(who)
    await expense(other,80000,fixedCostId)
    const posted = await detail(who)
    await suppress(fixedCostId)
    const suppressed = await detail(who)
    expect(posted).toEqual(before)
    expect(suppressed).toEqual(before)
    expect(before.fixedCosts[0]).toMatchObject({ postingStatus: 'unknown', postedExpense: null })
  })
  it('本人支出の権限外固定費への補助ID/年月を秘匿し、支出本体は返す', async () => {
    const who = await actor(), other = await actor(who.householdId)
    const privateCost = await cost(other,{owner:other.userId})
    const expenseId = await expense(who,2000,privateCost)
    expect((await detail(who)).finance.expenses).toEqual([{id:expenseId,expenseDate:'2026-11-05',amount:2000,purpose:'[E2E_TEST] expense',fixedCostId:null,fixedCostYearMonth:null}])
  })
  it('支出日・予定額の編集を実績額/計上年月と混同しない', async () => {
    const who = await actor(), fixedCostId = await cost(who,{amount:90000})
    const postedId = await expense(who,80000,fixedCostId,'2026-11-06')
    const body = await detail(who)
    expect(body.finance.expense).toBe(0)
    expect(body.fixedCosts[0]).toMatchObject({amount:90000,postingStatus:'posted',postedExpense:{id:postedId,expenseDate:'2026-11-06',amount:80000}})
    expect((await detail(who,'2026-11-06')).finance.expense).toBe(80000)
    await env.DB.prepare('DELETE FROM fixed_costs WHERE id=?').bind(fixedCostId).run()
    const deleted = await detail(who,'2026-11-06')
    expect(deleted.fixedCosts).toEqual([])
    expect(deleted.finance.expenses[0]).toMatchObject({id:postedId,fixedCostId:null,fixedCostYearMonth:null})
  })
  it('本人支出が抑止より優先し、安全な固定メッセージで警告する', async () => {
    const who=await actor(), fixedCostId=await cost(who)
    await expense(who,80000,fixedCostId); await suppress(fixedCostId)
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>{})
    try {
      expect((await detail(who)).fixedCosts[0].postingStatus).toBe('posted')
      expect(warning).toHaveBeenCalledWith('Fixed cost has both posting and suppression records.')
    } finally { warning.mockRestore() }
  })
  it('抑止だけの本人固定費はsuppressed', async () => {
    const who=await actor(), fixedCostId=await cost(who)
    await suppress(fixedCostId)
    expect((await detail(who)).fixedCosts[0]).toMatchObject({postingStatus:'suppressed',postedExpense:null})
  })
  it.each([['2026-11-01','2026-10-26'],['2027-01-01','2026-12-28']])('月/年跨ぎ %s の選択週 %s とレシピ削除nullを返す', async (date,week) => {
    const who=await actor(), other=await actor()
    const recipeId=await id('INSERT INTO recipes(household_id,created_by_user_id,title,url) VALUES(?,?,?,?)',who.householdId,who.userId,'[E2E_TEST] recipe','https://example.com/recipe')
    const menuId=await id('INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES(?,?,?)',who.householdId,recipeId,week)
    await id('INSERT INTO menu_entries(household_id,free_text_memo,week_start_date) VALUES(?,?,?)',other.householdId,'[E2E_TEST] hidden',week)
    expect((await detail(who,date)).menuEntries).toEqual([{id:menuId,recipeId,recipeTitle:'[E2E_TEST] recipe',freeTextMemo:null,weekStartDate:week}])
    await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipeId).run()
    expect((await detail(who,date)).menuEntries).toEqual([{id:menuId,recipeId:null,recipeTitle:null,freeTextMemo:null,weekStartDate:week}])
  })
  it('同IDの異年月の支出・抑止を選択月の計上状態へ混ぜない', async () => {
    const who=await actor(), fixedCostId=await cost(who)
    await expense(who,80000,fixedCostId,'2099-11-05','2099-10')
    await suppress(fixedCostId,'2099-12')
    const body=await detail(who,'2099-11-05')
    expect(body.finance.expense).toBe(80000)
    expect(body.fixedCosts[0]).toMatchObject({yearMonth:'2099-11',postingStatus:'scheduled',postedExpense:null})
  })
  it('不整合な別世帯レシピ参照からタイトルを露出しない', async () => {
    const who=await actor(), other=await actor()
    const recipeId=await id('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,?)',other.householdId,other.userId,'[E2E_TEST] hidden recipe')
    await id('INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES(?,?,?)',who.householdId,recipeId,'2026-11-02')
    expect((await detail(who)).menuEntries[0]).toMatchObject({recipeTitle:null})
  })
  it('GET反復で全テーブルの保存状態を変えず、カテゴリseedや自動計上もしない', async () => {
    const who=await actor(), other=await actor(who.householdId)
    const fixedCostId=await cost(who)
    const expenseId=await expense(who)
    await income(who)
    const accountId=await id('INSERT INTO accounts(household_id,owner_user_id,name,type,balance) VALUES(?,?,?,?,?)',who.householdId,who.userId,'[E2E_TEST] account','bank',100000)
    const cardId=await id('INSERT INTO cards(account_id,name,card_type,balance) VALUES(?,?,?,?)',accountId,'[E2E_TEST] card','charge',50000)
    await env.DB.prepare('UPDATE fixed_costs SET card_id=? WHERE id=?').bind(cardId,fixedCostId).run()
    await id('INSERT INTO fixed_cost_splits(fixed_cost_id,debtor_user_id,split_ratio,amount_due) VALUES(?,?,?,?)',fixedCostId,other.userId,50,40000)
    await id('INSERT INTO expense_splits(expense_id,debtor_user_id,split_ratio,amount_due) VALUES(?,?,?,?)',expenseId,other.userId,50,1000)
    const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*' ORDER BY name").all<{name:string}>()).results
    const snapshot=async()=>Promise.all(tables.map(async ({name})=>({name,rows:(await env.DB.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()).results})))
    const before=await snapshot()
    await detail(who); await detail(who)
    expect(await snapshot()).toEqual(before)
  })
  it('SQL取得失敗は空配列/unknownの成功応答にしない', async () => {
    const who=await actor()
    const db=new Proxy(env.DB,{get(target,key){if(key==='batch') return ()=>{throw new Error('test database unavailable')}; const value=Reflect.get(target,key,target); return typeof value==='function'?value.bind(target):value}})
    const error=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {
      const response=await app.request('/api/dashboard/day-detail?date=2026-11-05',{headers:who.headers},{...env,DB:db})
      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Internal Server Error')
    } finally {error.mockRestore()}
  })
})
