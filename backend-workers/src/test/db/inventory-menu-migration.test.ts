import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect,it } from 'vitest'
it('真pre0028から全最新migrationへ旧在庫・日次設定・原本・通常献立・自由メモを不変で移行する',async()=>{
 const {MIGRATION_DB:db,TEST_MIGRATIONS:migrations}=env as unknown as {MIGRATION_DB:D1Database;TEST_MIGRATIONS:D1Migration[]}
 const migration=migrations.find(m=>m.name.startsWith('0028'))!
 await applyD1Migrations(db,migrations.filter(m=>m.name<migration.name))
 await db.batch([
 db.prepare("INSERT INTO users(id,email,password_hash,display_name) VALUES(1,'testuser_migration@example.com','dummy','testuser_migration')"),
 db.prepare("INSERT INTO households(id,name,invite_code) VALUES(1,'[E2E_TEST] migration','testuser_547')"),
 db.prepare("INSERT INTO zaiko_categories(id,household_id,name) VALUES(1,1,'[E2E_TEST] food')"),
 db.prepare("INSERT INTO inventory_items(id,household_id,name,category_id,quantity_tenths,threshold_tenths,daily_consumption_tenths,auto_consumption_enabled,last_consumed_on) VALUES(1,1,'[E2E_TEST] stock',1,25,10,2,1,'2026-11-14')"),
 db.prepare("INSERT INTO recipes(id,household_id,created_by_user_id,title) VALUES(1,1,1,'[E2E_TEST] recipe')"),
 db.prepare("INSERT INTO menu_entries(household_id,recipe_id,free_text_memo,week_start_date) VALUES(1,1,NULL,'2026-11-09'),(1,NULL,'[E2E_TEST] memo','2026-11-09')"),
 ])
 const inventories=(await db.prepare('SELECT * FROM inventory_items').all()).results
 const recipes=(await db.prepare('SELECT * FROM recipes').all()).results
 const menus=(await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results
 await applyD1Migrations(db,migrations.filter(m=>m.name>=migration.name))
 expect((await db.prepare('SELECT * FROM inventory_items').all()).results).toEqual(inventories.map(row=>({...row,menu_plan_enabled:0,menu_plan_revision:0})))
 expect((await db.prepare('SELECT * FROM recipes').all()).results).toEqual(recipes)
 expect((await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results).toEqual(menus.map(row=>({...row,inventory_menu_link_id:null,usage_tenths:null,meal_state:'uneaten',meal_revision:0,consumed_event_id:null,recipe_title_snapshot:null})))
 expect((await db.prepare('SELECT * FROM inventory_menu_links').all()).results).toEqual([])
})
