import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

let householdId: number, userId: number, itemId: number, recipeId: number
beforeEach(async () => {
  userId = (await env.DB.prepare("INSERT INTO users(email,password_hash,display_name) VALUES(?,'dummy','testuser_menu') RETURNING id").bind('testuser_' + crypto.randomUUID() + '@example.com').first<{id:number}>())!.id
  householdId = (await env.DB.prepare("INSERT INTO households(name,invite_code) VALUES('[E2E_TEST] menu',?) RETURNING id").bind(crypto.randomUUID()).first<{id:number}>())!.id
  const categoryId = (await env.DB.prepare("INSERT INTO zaiko_categories(household_id,name) VALUES(?,'[E2E_TEST] food') RETURNING id").bind(householdId).first<{id:number}>())!.id
  itemId = (await env.DB.prepare("INSERT INTO inventory_items(household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(?,'[E2E_TEST] chicken',?,30,10) RETURNING id").bind(householdId,categoryId).first<{id:number}>())!.id
  recipeId = (await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] ham') RETURNING id").bind(householdId,userId).first<{id:number}>())!.id
})
async function link(carry = 1) {
  return (await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,carry_enabled) VALUES(?,?,?,'[E2E_TEST] ham','2026-11-09',?) RETURNING id").bind(householdId,itemId,recipeId,carry).first<{id:number}>())!.id
}
describe('献立連携DBの制約と既存行', () => {
  it('通常献立は未連携・未食として保存される', async () => {
    const row = await env.DB.prepare("INSERT INTO menu_entries(household_id,free_text_memo,week_start_date) VALUES(?,'[E2E_TEST] memo','2026-11-09') RETURNING *").bind(householdId).first()
    expect(row).toMatchObject({inventory_menu_link_id:null,usage_tenths:null,meal_state:'uneaten',meal_revision:0,consumed_event_id:null})
  })
  it('0到達は全関連を停止し、補充しても持越しを再開しない', async () => {
    const id = await link()
    await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=?').bind(itemId).run()
    expect(await env.DB.prepare('SELECT carry_enabled,revision FROM inventory_menu_links WHERE id=?').bind(id).first()).toEqual({carry_enabled:0,revision:1})
    await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=30 WHERE id=?').bind(itemId).run()
    expect(await env.DB.prepare('SELECT carry_enabled FROM inventory_menu_links WHERE id=?').bind(id).first()).toEqual({carry_enabled:0})
  })
  it('日次消費ONへの変更を有効連携中は拒否する', async () => {
    await link()
    await expect(env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=1,daily_consumption_tenths=1,last_consumed_on=DATE() WHERE id=?').bind(itemId).run()).rejects.toThrow('menu_link_daily_conflict')
  })
  it('日次消費ON在庫へのリンクと在庫0の持越しをDBで拒否する', async () => {
    await env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=1,daily_consumption_tenths=1,last_consumed_on=DATE() WHERE id=?').bind(itemId).run()
    await expect(link()).rejects.toThrow('menu_link_daily_conflict')
    await env.DB.prepare('UPDATE inventory_items SET auto_consumption_enabled=0,quantity_tenths=0 WHERE id=?').bind(itemId).run()
    await expect(link()).rejects.toThrow('menu_link_zero_carry')
  })
  it('原本削除で関連停止と参照解除、既存週行は保持する', async () => {
    const id = await link()
    await env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,?,'2026-11-09',?,10)").bind(householdId,recipeId,id).run()
    await env.DB.prepare('DELETE FROM recipes WHERE id=?').bind(recipeId).run()
    expect(await env.DB.prepare('SELECT enabled,carry_enabled,recipe_id FROM inventory_menu_links WHERE id=?').bind(id).first()).toEqual({enabled:0,carry_enabled:0,recipe_id:null})
    expect(await env.DB.prepare('SELECT recipe_id,inventory_menu_link_id FROM menu_entries WHERE inventory_menu_link_id=?').bind(id).first()).toEqual({recipe_id:null,inventory_menu_link_id:id})
  })
  it('同関連同週だけ一意、通常原本再追加は維持する', async () => {
    const id = await link()
    const insert = () => env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths) VALUES(?,?,'2026-11-09',?,10)").bind(householdId,recipeId,id).run()
    await insert()
    await expect(insert()).rejects.toThrow('UNIQUE')
    for(let n=0;n<2;n++) await env.DB.prepare("INSERT INTO menu_entries(household_id,recipe_id,week_start_date) VALUES(?,?,'2026-11-09')").bind(householdId,recipeId).run()
  })
})



it('在庫0は同じ在庫の複数関連をまとめて停止する',async()=>{
 const first=await link()
 const recipe=(await env.DB.prepare("INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(?,?,'[E2E_TEST] second') RETURNING id").bind(householdId,userId).first<{id:number}>())!
 const second=(await env.DB.prepare("INSERT INTO inventory_menu_links(household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,carry_enabled) VALUES(?,?,?,'[E2E_TEST] second','2026-11-09',1) RETURNING id").bind(householdId,itemId,recipe.id).first<{id:number}>())!
 await env.DB.prepare('UPDATE inventory_items SET quantity_tenths=0 WHERE id=?').bind(itemId).run()
 expect((await env.DB.prepare('SELECT carry_enabled,revision FROM inventory_menu_links WHERE id IN(?,?) ORDER BY id').bind(first,second.id).all()).results).toEqual([{carry_enabled:0,revision:1},{carry_enabled:0,revision:1}])
})
