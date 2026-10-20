import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('0021 keeps old quantities and shopping entries, defaults off, and enforces constraints', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as { MIGRATION_DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
  const migration = migrations.find(m => m.name.startsWith('0021'))!
  expect(migration).toBeDefined()
  await applyD1Migrations(db, migrations.filter(m => m.name < migration.name))
  await db.batch([
    db.prepare("INSERT INTO households (id, name, invite_code) VALUES (1, '[E2E_TEST] migration', 'testuser_329')"),
    db.prepare("INSERT INTO zaiko_categories (id, household_id, name) VALUES (1, 1, '[E2E_TEST] food')"),
    db.prepare("INSERT INTO inventory_items (id, household_id, name, category_id, quantity_tenths, threshold_tenths) VALUES (1, 1, '[E2E_TEST] stock', 1, 25, 10)"),
    db.prepare('INSERT INTO shopping_list_items (inventory_item_id, household_id, is_manual) VALUES (1, 1, 1)'),
  ])
  const entries = (await db.prepare('SELECT * FROM shopping_list_items').all()).results
  await applyD1Migrations(db, [migration])
  expect(await db.prepare('SELECT quantity_tenths, threshold_tenths, daily_consumption_tenths, auto_consumption_enabled, last_consumed_on, consumption_revision FROM inventory_items WHERE id = 1').first())
    .toEqual({ quantity_tenths: 25, threshold_tenths: 10, daily_consumption_tenths: null, auto_consumption_enabled: 0, last_consumed_on: null, consumption_revision: 0 })
  expect((await db.prepare('SELECT * FROM shopping_list_items').all()).results).toEqual(entries)
  for (const assignment of ['daily_consumption_tenths = 0', 'daily_consumption_tenths = -1', 'daily_consumption_tenths = 1000000', 'daily_consumption_tenths = 1.5', 'auto_consumption_enabled = 2', 'auto_consumption_enabled = 1', 'consumption_revision = -1', 'consumption_revision = 0.5']) {
    await expect(db.prepare(`UPDATE inventory_items SET ${assignment} WHERE id = 1`).run()).rejects.toThrow()
  }
  await db.prepare("UPDATE inventory_items SET daily_consumption_tenths = 1, last_consumed_on = '2024-02-29', auto_consumption_enabled = 1 WHERE id = 1").run()
  await expect(db.prepare('UPDATE inventory_items SET daily_consumption_tenths = NULL WHERE id = 1').run()).rejects.toThrow()
  await expect(db.prepare('UPDATE inventory_items SET last_consumed_on = NULL WHERE id = 1').run()).rejects.toThrow()
})
