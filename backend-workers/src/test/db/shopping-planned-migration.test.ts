import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('0025 preserves every old shopping column and enforces planned quantities and terminal ledger constraints', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as { MIGRATION_DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
  const migration = migrations.find(m => m.name.startsWith('0025'))
  expect(migration).toBeDefined()
  if (!migration) return
  await applyD1Migrations(db, migrations.filter(m => m.name < migration.name))
  await db.batch([
    db.prepare("INSERT INTO users (id,email,password_hash,display_name) VALUES (1,'testuser_migration@example.com','dummy','[E2E_TEST] user')"),
    db.prepare("INSERT INTO households (id,name,invite_code) VALUES (1,'[E2E_TEST] migration','testuser_455')"),
    db.prepare("INSERT INTO zaiko_categories (id,household_id,name) VALUES (1,1,'[E2E_TEST] food')"),
    db.prepare("INSERT INTO inventory_items (id,household_id,name,category_id,quantity_tenths,threshold_tenths,price) VALUES (1,1,'[E2E_TEST] stock',1,25,10,123),(2,1,'[E2E_TEST] stock2',1,5,10,NULL)"),
    db.prepare('INSERT INTO shopping_list_items (household_id,inventory_item_id,is_manual,purchased,purchased_quantity_tenths,purchase_revision) VALUES (1,1,1,1,30,7),(1,2,0,0,0,2)'),
  ])
  const old = (await db.prepare('SELECT * FROM shopping_list_items ORDER BY id').all()).results
  await applyD1Migrations(db, [migration])
  expect((await db.prepare('SELECT * FROM shopping_list_items ORDER BY id').all()).results).toEqual(old.map(row => ({ ...row, planned_quantity_tenths: 10, planned_quantity_explicit: 0 })))
  for (const assignment of ['planned_quantity_tenths=0','planned_quantity_tenths=-1','planned_quantity_tenths=1000000','planned_quantity_tenths=1.5','planned_quantity_explicit=2']) {
    await expect(db.prepare(`UPDATE shopping_list_items SET ${assignment} WHERE id=1`).run()).rejects.toThrow()
  }
  for (const status of [200,400,404,409]) {
    await db.prepare('INSERT INTO shopping_purchase_requests (household_id,actor_user_id,request_id,request_json,response_status,response_json) VALUES (1,1,?,?,?,?)').bind(String(status),'{}',status,'{}').run()
  }
  await expect(db.prepare("INSERT INTO shopping_purchase_requests (household_id,actor_user_id,request_id,request_json,response_status) VALUES (1,1,'bad','{}',500)").run()).rejects.toThrow()
  await expect(db.prepare("UPDATE shopping_purchase_requests SET guard=0 WHERE request_id='200'").run()).rejects.toThrow(/shopping_purchase_guard/)
  await expect(db.prepare("INSERT INTO shopping_purchase_requests (household_id,actor_user_id,request_id,request_json) VALUES (1,1,'200','{}')").run()).rejects.toThrow(/UNIQUE/)
  await db.prepare('DELETE FROM users WHERE id=1').run()
  expect((await db.prepare('SELECT * FROM shopping_purchase_requests').all()).results).toEqual([])
})
