import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import app from '../../index'
import { carryMenuEntries } from '../../lib/menu-carryover'
import { purgePastMenuEntries } from '../../lib/menu-entry-cleanup'
import { signAccessToken } from '../../lib/jwt'

beforeEach(async () => {
  await env.DB.batch(['menu_operation_requests', 'menu_consumption_events', 'menu_entries', 'inventory_menu_links', 'shopping_list_items', 'inventory_items', 'recipes', 'zaiko_categories', 'household_members', 'households', 'users'].map(t => env.DB.prepare(`DELETE FROM ${t}`)))
})

async function seed(options: { quantity?: number; carry?: boolean; enabled?: boolean; startsOn?: string; usage?: number } = {}) {
  const key = crypto.randomUUID()
  const user = (await env.DB.prepare('INSERT INTO users(email,password_hash,display_name) VALUES (?,?,?) RETURNING id').bind(`testuser_${key}@example.com`, 'unused', 'testuser_carry').first<{ id: number }>())!.id
  const home = (await env.DB.prepare('INSERT INTO households(name,invite_code) VALUES (?,?) RETURNING id').bind('[E2E_TEST] carry', key).first<{ id: number }>())!.id
  const category = (await env.DB.prepare('INSERT INTO zaiko_categories(household_id,name) VALUES (?,?) RETURNING id').bind(home, '[E2E_TEST] food').first<{ id: number }>())!.id
  const inventory = (await env.DB.prepare('INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES (?,?,?,?,0) RETURNING id').bind(home, '[E2E_TEST] stock', category, options.quantity ?? 30).first<{ id: number }>())!.id
  const recipe = (await env.DB.prepare('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES (?,?,?) RETURNING id').bind(home, user, '[E2E_TEST] recipe').first<{ id: number }>())!.id
  const link = (await env.DB.prepare('INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,usage_tenths,enabled,carry_enabled,starts_on) VALUES (?,?,?,?,?,?,?,?) RETURNING id').bind(home, inventory, recipe, '[E2E_TEST] recipe snapshot', options.usage ?? 10, Number(options.enabled ?? true), Number(options.carry ?? true), options.startsOn ?? '2026-10-19').first<{ id: number }>())!.id
  return { user, home, inventory, recipe, link }
}

it('持越しの名前は各週の生成時原本名で、前週食済名や同週既存名を上書きしない', async () => {
  const s = await seed()
  await env.DB.prepare('INSERT INTO household_members(household_id,user_id) VALUES (?,?)').bind(s.home,s.user).run()
  const headers = { Authorization: 'Bearer '+await signAccessToken(s.user,env.JWT_SECRET,900) }
  const list = async (week: string) => {
    const response = await app.request('/api/menu-entries?weekStartDate='+week,{headers},env)
    expect(response.status).toBe(200)
    return response.json<{id:number;recipeTitle:string;inventoryLinkage:{mealState:string}}[]>()
  }
  expect(await carryMenuEntries(env.DB,new Date('2026-10-18T15:00:00Z'))).toBe(1)
  const previous = await list('2026-10-19')
  expect(previous).toHaveLength(1)
  expect(previous[0].recipeTitle).toBe('[E2E_TEST] recipe')
  await env.DB.prepare("UPDATE menu_entries SET meal_state='eaten',meal_revision=1 WHERE id=?").bind(previous[0].id).run()
  await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] next week recipe',s.recipe).run()
  expect(await carryMenuEntries(env.DB,new Date('2026-10-25T15:00:00Z'))).toBe(1)
  const current = await list('2026-10-26')
  expect(current).toHaveLength(1)
  expect(current[0]).toMatchObject({recipeTitle:'[E2E_TEST] next week recipe',inventoryLinkage:{mealState:'uneaten'}})
  expect(await list('2026-10-19')).toEqual([expect.objectContaining({id:previous[0].id,recipeTitle:'[E2E_TEST] recipe',inventoryLinkage:expect.objectContaining({mealState:'eaten'})})])
  await env.DB.prepare('UPDATE recipes SET title=? WHERE id=?').bind('[E2E_TEST] later rename',s.recipe).run()
  expect(await carryMenuEntries(env.DB,new Date('2026-10-25T16:00:00Z'))).toBe(0)
  expect(await list('2026-10-26')).toEqual(current)
  expect((await list('2026-10-19'))[0]).toMatchObject({recipeTitle:'[E2E_TEST] recipe',inventoryLinkage:{mealState:'eaten'}})
})

it('食済の前週から今週の未食行を一度だけ生成し、在庫・過去行・食事履歴を変更しない', async () => {
  const s = await seed({ usage: 15 })
  await env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,meal_state,meal_revision,consumed_event_id,recipe_title_snapshot) VALUES (?,?,'2026-10-19',?,10,'eaten',3,'old-event','[E2E_TEST] recipe')").bind(s.home, s.recipe, s.link).run()
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(1)
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T16:00:00Z'))).toBe(0)
  const rows = (await env.DB.prepare('SELECT week_start_date,usage_tenths,meal_state,meal_revision,consumed_event_id FROM menu_entries ORDER BY week_start_date').all()).results
  expect(rows).toEqual([
    { week_start_date: '2026-10-19', usage_tenths: 10, meal_state: 'eaten', meal_revision: 3, consumed_event_id: 'old-event' },
    { week_start_date: '2026-10-26', usage_tenths: 15, meal_state: 'uneaten', meal_revision: 0, consumed_event_id: null },
  ])
  expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(s.inventory).first('quantity_tenths')).toBe(30)
  expect(await env.DB.prepare('SELECT count(*) AS n FROM menu_consumption_events').first('n')).toBe(0)
})

it('真の並行carryでも同じ関連・週に一行だけ生成する', async () => {
  await seed()
  const results = await Promise.all([carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z')), carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))])
  expect(results.sort()).toEqual([0, 1])
  expect(await env.DB.prepare('SELECT count(*) AS n FROM menu_entries').first('n')).toBe(1)
})

it('JST月曜境界・年跨ぎと数週の遅延でも、実行時の現在週だけ補完する', async () => {
  await seed({ startsOn: '2025-12-01' })
  expect(await carryMenuEntries(env.DB, new Date('2026-01-04T14:59:59Z'))).toBe(1)
  expect(await carryMenuEntries(env.DB, new Date('2026-01-04T15:00:00Z'))).toBe(1)
  expect((await env.DB.prepare('SELECT week_start_date FROM menu_entries ORDER BY week_start_date').all()).results).toEqual([{ week_start_date: '2025-12-29' }, { week_start_date: '2026-01-05' }])
})

it('過去週削除が先行しても独立した関連から補完し、通常の未来行と既存食済行を上書きしない', async () => {
  const s = await seed()
  await env.DB.batch([
    env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,recipe_title_snapshot) VALUES (?,?,'2026-10-19',?,10,'[E2E_TEST] recipe')").bind(s.home, s.recipe, s.link),
    env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES (?,?,'2026-11-02')").bind(s.home, s.recipe),
  ])
  await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(1)
  await env.DB.prepare("UPDATE menu_entries SET meal_state='eaten',meal_revision=4,usage_tenths=7,consumed_event_id='retained' WHERE inventory_menu_link_id=?").bind(s.link).run()
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T16:00:00Z'))).toBe(0)
  expect(await env.DB.prepare('SELECT meal_state,meal_revision,usage_tenths,consumed_event_id FROM menu_entries WHERE inventory_menu_link_id=?').bind(s.link).first()).toEqual({ meal_state: 'eaten', meal_revision: 4, usage_tenths: 7, consumed_event_id: 'retained' })
  expect(await env.DB.prepare("SELECT count(*) AS n FROM menu_entries WHERE week_start_date='2026-11-02' AND inventory_menu_link_id IS NULL").first('n')).toBe(1)
})

it('ゼロ停止後の補充では再開せず、無効・OFF・開始前・削除済み参照も生成しない', async () => {
  const zero = await seed()
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=?').bind(zero.inventory).run()
  await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=20 WHERE id=?').bind(zero.inventory).run()
  await seed({ enabled: false, carry: false })
  await seed({ carry: false })
  await seed({ startsOn: '2026-11-02' })
  const deletedStock = await seed()
  await env.DB.prepare('DELETE FROM inventory_items WHERE id=?').bind(deletedStock.inventory).run()
  const deletedRecipe = await seed()
  await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(deletedRecipe.recipe).run()
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(0)
  expect(await env.DB.prepare('SELECT carry_enabled FROM inventory_menu_links WHERE id=?').bind(zero.link).first('carry_enabled')).toBe(0)
})

it('同じ在庫の別レシピ・別在庫の同じ原本を別行として持ち越し、通常の同原本行も残す', async () => {
  const s = await seed()
  const recipe2 = (await env.DB.prepare('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES (?,?,?) RETURNING id').bind(s.home, s.user, '[E2E_TEST] second recipe').first<{ id: number }>())!.id
  const category = await env.DB.prepare('SELECT category_id FROM inventory_items WHERE id=?').bind(s.inventory).first<number>('category_id')
  const stock2 = (await env.DB.prepare('INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES (?,?,?,20,0) RETURNING id').bind(s.home, '[E2E_TEST] second stock', category).first<{ id: number }>())!.id
  await env.DB.batch([
    env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,carry_enabled) VALUES (?,?,?,?,'2026-10-19',1)").bind(s.home, s.inventory, recipe2, '[E2E_TEST] second recipe'),
    env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,carry_enabled) VALUES (?,?,?,?,'2026-10-19',1)").bind(s.home, stock2, s.recipe, '[E2E_TEST] recipe'),
    env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES (?,?,'2026-10-26')").bind(s.home, s.recipe),
  ])
  expect(await carryMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(3)
  expect(await env.DB.prepare('SELECT count(*) AS n FROM menu_entries').first('n')).toBe(4)
})

it('実scheduled経路でも持越し後に旧週を消し、再実行で在庫・食事履歴を増減しない', async () => {
  const s = await seed({ startsOn: '2020-01-06' })
  await env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,meal_state,recipe_title_snapshot) VALUES (?,?,'2020-01-06',?,10,'eaten','[E2E_TEST] recipe')").bind(s.home, s.recipe, s.link).run()
  const cron = { cron: '0 15 * * *', scheduledTime: Date.now() } as ScheduledController
  await app.scheduled(cron, { ...env })
  await app.scheduled(cron, { ...env })
  const rows = (await env.DB.prepare('SELECT meal_state FROM menu_entries WHERE inventory_menu_link_id=?').bind(s.link).all()).results
  expect(rows).toEqual([{ meal_state: 'uneaten' }])
  expect(await env.DB.prepare('SELECT quantity_tenths FROM inventory_items WHERE id=?').bind(s.inventory).first('quantity_tenths')).toBe(30)
  expect(await env.DB.prepare('SELECT count(*) AS n FROM inventory_menu_links').first('n')).toBe(1)
})
