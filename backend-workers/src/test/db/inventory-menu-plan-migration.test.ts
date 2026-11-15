import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('真pre0030の小数usage・旧OFF・削除済み原本・食事履歴・成功JSONを整数計画へ変換せず保持する', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as {
    MIGRATION_DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  // The fixture is deliberately created before the new migration, rather than by
  // inserting legacy-shaped rows into an already upgraded database.
  await applyD1Migrations(db, migrations.filter(migration => migration.name < '0030'))
  expect((await db.prepare('PRAGMA table_info(inventory_menu_links)').all<{ name: string }>()).results
    .some(column => column.name === 'remaining_count')).toBe(false)
  await db.batch([
    db.prepare("INSERT INTO users(id,email,password_hash,display_name) VALUES(1,'testuser_plan_migration@example.com','dummy','testuser_plan_migration')"),
    db.prepare("INSERT INTO households(id,name,invite_code) VALUES(1,'[E2E_TEST] plan migration','testuser_554')"),
    db.prepare("INSERT INTO zaiko_categories(id,household_id,name) VALUES(1,1,'[E2E_TEST] food')"),
    db.prepare("INSERT INTO inventory_items(id,household_id,name,category_id,quantity_tenths,threshold_tenths,price) VALUES(1,1,'[E2E_TEST] mixed',1,35,10,123),(2,1,'[E2E_TEST] all off',1,25,5,NULL),(3,1,'[E2E_TEST] ordinary daily',1,45,10,456),(4,1,'[E2E_TEST] ordinary',1,15,5,NULL),(5,1,'[E2E_TEST] deleted inventory',1,20,5,NULL)"),
    db.prepare("UPDATE inventory_items SET daily_consumption_tenths=2,auto_consumption_enabled=1,last_consumed_on='2026-11-14' WHERE id=3"),
    db.prepare("INSERT INTO recipes(id,household_id,created_by_user_id,title,memo) VALUES(1,1,1,'[E2E_TEST] half recipe','[E2E_TEST] original memo'),(2,1,1,'[E2E_TEST] one and half recipe',NULL),(3,1,1,'[E2E_TEST] deleted recipe',NULL),(4,1,1,'[E2E_TEST] detached recipe',NULL)"),
    db.prepare("INSERT INTO inventory_menu_links(id,household_id,inventory_item_id,recipe_id,recipe_title_snapshot,usage_tenths,enabled,carry_enabled,starts_on) VALUES(1,1,1,1,'[E2E_TEST] half snapshot',5,1,1,'2026-11-09'),(2,1,1,2,'[E2E_TEST] one and half snapshot',15,0,0,'2026-11-09'),(3,1,2,3,'[E2E_TEST] deleted snapshot',15,1,1,'2026-11-09'),(4,1,5,4,'[E2E_TEST] detached snapshot',5,1,0,'2026-11-09')"),
    db.prepare("INSERT INTO menu_entries(id,household_id,recipe_id,week_start_date,inventory_menu_link_id,usage_tenths,meal_state,meal_revision,consumed_event_id,recipe_title_snapshot) VALUES(1,1,1,'2026-11-09',1,5,'uneaten',0,NULL,'[E2E_TEST] half week'),(2,1,2,'2026-11-09',2,15,'eaten',3,'testuser_event_15','[E2E_TEST] eaten week'),(3,1,3,'2026-11-09',3,15,'uneaten',0,NULL,'[E2E_TEST] deleted week'),(4,1,4,'2026-11-09',4,5,'eaten',1,'testuser_event_5','[E2E_TEST] detached week')"),
    db.prepare("INSERT INTO menu_entries(id,household_id,recipe_id,free_text_memo,week_start_date) VALUES(5,1,1,NULL,'2026-11-09'),(6,1,NULL,'[E2E_TEST] ordinary memo','2026-11-09')"),
    db.prepare("INSERT INTO menu_consumption_events(id,household_id,menu_entry_id,inventory_item_id,quantity_tenths,undone_at) VALUES('testuser_event_15',1,2,1,15,NULL),('testuser_event_5',1,4,5,5,NULL),('testuser_undone_event',1,1,1,5,'2026-11-14T00:00:00.000Z')"),
    db.prepare('INSERT INTO menu_operation_requests(household_id,actor_user_id,request_id,request_json,response_status,response_json) VALUES(1,1,?,?,200,?)').bind(
      'testuser_legacy_success',
      '{"version":1,"operation":"consume","usageQuantity":1.5}',
      '{ "menuEntryId": 2, "usageQuantity": 1.5, "quantity": 3.5, "carryEnabled": false }',
    ),
    db.prepare('DELETE FROM recipes WHERE id=3'),
    db.prepare('DELETE FROM inventory_items WHERE id=5'),
  ])
  const inventories = (await db.prepare('SELECT * FROM inventory_items ORDER BY id').all()).results
  const links = (await db.prepare('SELECT * FROM inventory_menu_links ORDER BY id').all()).results
  const meals = (await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results
  const recipes = (await db.prepare('SELECT * FROM recipes ORDER BY id').all()).results
  const events = (await db.prepare('SELECT * FROM menu_consumption_events ORDER BY id').all()).results
  const successes = (await db.prepare('SELECT * FROM menu_operation_requests').all()).results

  const migration = migrations.find(candidate => candidate.name.startsWith('0030'))
  expect(migration, '旧usageを保持する追加型0030 migrationが必要').toBeDefined()
  if (!migration) throw new Error('0030 migration missing')
  await applyD1Migrations(db, migrations.filter(candidate => candidate.name >= migration.name))

  expect((await db.prepare('SELECT * FROM inventory_items ORDER BY id').all()).results)
    .toEqual(inventories.map(row => ({ ...row, menu_plan_enabled: 0, menu_plan_revision: 0 })))
  expect((await db.prepare('SELECT * FROM inventory_menu_links ORDER BY id').all()).results)
    .toEqual(links.map(row => ({ ...row, remaining_count: null, memo: null })))
  expect((await db.prepare('SELECT * FROM menu_entries ORDER BY id').all()).results).toEqual(meals)
  expect((await db.prepare('SELECT * FROM recipes ORDER BY id').all()).results).toEqual(recipes)
  expect((await db.prepare('SELECT * FROM menu_consumption_events ORDER BY id').all()).results)
    .toEqual(events.map(row => ({ ...row, plan_count_delta: null, inventory_menu_link_id: null })))
  expect((await db.prepare('SELECT * FROM menu_operation_requests').all()).results).toEqual(successes)
  // Literal assertions catch accidental rounding/revival even if fixture snapshots change.
  expect((await db.prepare('SELECT id,usage_tenths,enabled,carry_enabled,remaining_count FROM inventory_menu_links ORDER BY id').all()).results).toEqual([
    { id: 1, usage_tenths: 5, enabled: 1, carry_enabled: 1, remaining_count: null },
    { id: 2, usage_tenths: 15, enabled: 0, carry_enabled: 0, remaining_count: null },
    { id: 3, usage_tenths: 15, enabled: 0, carry_enabled: 0, remaining_count: null },
    { id: 4, usage_tenths: 5, enabled: 0, carry_enabled: 0, remaining_count: null },
  ])
  expect((await db.prepare('SELECT id,quantity_tenths FROM menu_consumption_events ORDER BY id').all()).results).toEqual([
    { id: 'testuser_event_15', quantity_tenths: 15 },
    { id: 'testuser_event_5', quantity_tenths: 5 },
    { id: 'testuser_undone_event', quantity_tenths: 5 },
  ])
})

it('新計画の回数は整数、メモは255文字以内、品目設定とrevisionはDB境界でも検証する', async () => {
  const { DB: db, TEST_MIGRATIONS: migrations } = env as unknown as {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  const migration = migrations.find(candidate => candidate.name.startsWith('0030'))
  expect(migration, '整数回数のDB契約を追加する0030 migrationが必要').toBeDefined()
  if (!migration) throw new Error('0030 migration missing')
  await applyD1Migrations(db, migrations)
  await db.batch([
    db.prepare("INSERT INTO users(id,email,password_hash,display_name) VALUES(1,'testuser_plan_constraints@example.com','dummy','testuser_plan_constraints')"),
    db.prepare("INSERT INTO households(id,name,invite_code) VALUES(1,'[E2E_TEST] plan constraints','testuser_554_constraints')"),
    db.prepare("INSERT INTO zaiko_categories(id,household_id,name) VALUES(1,1,'[E2E_TEST] food')"),
    db.prepare("INSERT INTO inventory_items(id,household_id,name,category_id,quantity_tenths,threshold_tenths) VALUES(1,1,'[E2E_TEST] planned',1,35,5)"),
    db.prepare("INSERT INTO recipes(id,household_id,created_by_user_id,title) VALUES(1,1,1,'[E2E_TEST] planned recipe')"),
    db.prepare("INSERT INTO inventory_menu_links(id,household_id,inventory_item_id,recipe_id,recipe_title_snapshot,starts_on,remaining_count,memo,carry_enabled) VALUES(1,1,1,1,'[E2E_TEST] planned recipe','2026-11-09',3,'[E2E_TEST] spicy',1)"),
  ])
  // An item-level OFF retains its independent count, memo and carry draft.
  expect(await db.prepare('SELECT i.menu_plan_enabled,l.remaining_count,l.memo,l.carry_enabled FROM inventory_items i JOIN inventory_menu_links l ON l.inventory_item_id=i.id WHERE i.id=1').first())
    .toEqual({ menu_plan_enabled: 0, remaining_count: 3, memo: '[E2E_TEST] spicy', carry_enabled: 1 })
  for (const count of [-1, 0.5, 100000]) {
    await expect(db.prepare('UPDATE inventory_menu_links SET remaining_count=? WHERE id=1').bind(count).run()).rejects.toThrow()
  }
  await db.prepare('UPDATE inventory_menu_links SET remaining_count=0,memo=? WHERE id=1').bind('あ'.repeat(255)).run()
  await expect(db.prepare('UPDATE inventory_menu_links SET memo=? WHERE id=1').bind('あ'.repeat(256)).run()).rejects.toThrow()
  await db.prepare('UPDATE inventory_menu_links SET remaining_count=NULL,memo=NULL WHERE id=1').run()
  for (const assignment of ['menu_plan_enabled=2', 'menu_plan_enabled=0.5', 'menu_plan_revision=-1', 'menu_plan_revision=0.5', 'menu_plan_revision=9007199254740992']) {
    await expect(db.prepare(`UPDATE inventory_items SET ${assignment} WHERE id=1`).run()).rejects.toThrow()
  }
  await db.prepare('UPDATE inventory_items SET menu_plan_enabled=1 WHERE id=1').run()
  await db.prepare('UPDATE inventory_items SET menu_plan_revision=9007199254740991 WHERE id=1').run()
  // Restore the boundary fixture before unrelated writes invalidate the aggregate CAS.
  await db.prepare('UPDATE inventory_items SET menu_plan_revision=0 WHERE id=1').run()
  await db.prepare("INSERT INTO menu_consumption_events(id,household_id,inventory_item_id,quantity_tenths,plan_count_delta,inventory_menu_link_id) VALUES('testuser_new_count_event',1,1,10,1,1)").run()
  for (const delta of [0, -1, 0.5, 2]) {
    await expect(db.prepare("UPDATE menu_consumption_events SET plan_count_delta=? WHERE id='testuser_new_count_event'").bind(delta).run()).rejects.toThrow()
  }
  // Unlinking preserves the event and its stock delta, and cannot attach it to a new link.
  await db.prepare('DELETE FROM inventory_menu_links WHERE id=1').run()
  expect(await db.prepare("SELECT quantity_tenths,plan_count_delta,inventory_menu_link_id FROM menu_consumption_events WHERE id='testuser_new_count_event'").first())
    .toEqual({ quantity_tenths: 10, plan_count_delta: 1, inventory_menu_link_id: null })
})
