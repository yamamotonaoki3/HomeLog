import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect,it } from 'vitest'

it('0029は既存連携週行を現原本名・削除済み関連名で補完し、通常行はNULLのまま移行する',async()=>{
 const {MIGRATION_DB:db,TEST_MIGRATIONS:migrations}=env as unknown as {MIGRATION_DB:D1Database;TEST_MIGRATIONS:D1Migration[]}
 const migration=migrations.find(m=>m.name.startsWith('0029'))
 expect(migration,'週行の名前snapshot用0029 migrationが必要').toBeDefined()
 if(!migration)throw new Error('0029 migration missing')
 await applyD1Migrations(db,migrations.filter(m=>m.name<migration.name))
 expect((await db.prepare('PRAGMA table_info(menu_entries)').all<{name:string}>()).results.some(column=>column.name==='recipe_title_snapshot')).toBe(false)
 await db.batch([
  db.prepare("INSERT INTO users(id,email,password_hash,display_name) VALUES(1,'testuser_snapshot_migration@example.com','dummy','testuser_snapshot_migration')"),
  db.prepare("INSERT INTO households(id,name,invite_code) VALUES(1,'[E2E_TEST] snapshot migration','testuser_550')"),
  db.prepare("INSERT INTO zaiko_categories(id,household_id,name) VALUES(1,1,'[E2E_TEST] food')"),
  db.prepare("INSERT INTO inventory_items(id,household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(1,1,'[E2E_TEST] stock',1,30,10)"),
  db.prepare("INSERT INTO recipes(id,household_id,created_by_user_id,title) VALUES(1,1,1,'[E2E_TEST] current title'),(2,1,1,'[E2E_TEST] deleted title')"),
  db.prepare("INSERT INTO inventory_menu_links(id,household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on) VALUES(1,1,1,1,'[E2E_TEST] old link title','2026-11-09'),(2,1,1,2,'[E2E_TEST] deleted link snapshot','2026-11-09')"),
  db.prepare("INSERT INTO menu_entries(id,household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,meal_state,meal_revision) VALUES(1,1,1,'2026-11-09',1,15,'eaten',1),(2,1,2,'2026-11-09',2,10,'uneaten',0)"),
  db.prepare("INSERT INTO menu_entries(id,household_id,recipe_id,free_text_memo,week_start_date) VALUES(3,1,1,NULL,'2026-11-09'),(4,1,2,NULL,'2026-11-09'),(5,1,NULL,'[E2E_TEST] memo','2026-11-09')"),
  db.prepare('DELETE FROM recipes WHERE id=2'),
 ])
 const meals=(await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results
 const links=(await db.prepare('SELECT * FROM inventory_menu_links ORDER BY id').all()).results
 const inventories=(await db.prepare('SELECT * FROM inventory_items').all()).results
 await applyD1Migrations(db,migrations.filter(m=>m.name>=migration.name))
 const names=['[E2E_TEST] current title','[E2E_TEST] deleted link snapshot',null,null,null]
 expect((await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results).toEqual(meals.map((row,index)=>({...row,recipe_title_snapshot:names[index]})))
 expect((await db.prepare('SELECT * FROM inventory_menu_links ORDER BY id').all()).results).toEqual(links)
 expect((await db.prepare('SELECT * FROM inventory_items').all()).results).toEqual(inventories)
})
