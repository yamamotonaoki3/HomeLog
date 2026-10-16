import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('preserves legacy rows, indexes, FK and cascade on an independent D1 database', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as { MIGRATION_DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
  const latest = migrations.find(m => m.name.startsWith('0016'))!
  expect(latest).toBeDefined()
  await applyD1Migrations(db, migrations.filter(m => m.name < latest.name))
  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash, display_name) VALUES (1, 'testuser_migration@example.com', 'dummy', 'testuser_migration')"),
    db.prepare("INSERT INTO households (id, name, invite_code) VALUES (1, '[E2E_TEST]', 'test253migration')"),
    db.prepare("INSERT INTO fixed_costs (id, household_id, created_by_user_id, name, amount, payment_day) VALUES (1, 1, 1, '[E2E_TEST]', 100, 1)"),
    db.prepare("INSERT INTO fixed_cost_splits (id, fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due, created_at) VALUES (42, 1, 1, 'amount', 25, 25, '2026-01-01 01:02:03')"),
  ])
  const old = await db.prepare('SELECT * FROM fixed_cost_splits').all()
  await applyD1Migrations(db, [latest])
  expect((await db.prepare('SELECT * FROM fixed_cost_splits').all()).results).toEqual(old.results.map(row => ({ ...row, debtor_external_id: null })))
  await db.prepare("INSERT INTO external_persons (id, household_id, name) VALUES (1, 1, 'testuser_friend')").run()
  await db.prepare("INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_external_id, split_ratio, amount_due) VALUES (1, 1, 50, 50)").run()
  await expect(db.prepare('INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_external_id, split_ratio, amount_due) VALUES (1, 999, 50, 50)').run()).rejects.toThrow()
  expect((await db.prepare("PRAGMA index_list('fixed_cost_splits')").all()).results).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'idx_fixed_cost_splits_fixed_cost_id' })]))
  const sql = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fixed_cost_splits'").first<{ sql: string }>()
  expect(sql!.sql.toUpperCase()).not.toContain('CHECK')
  await db.prepare('DELETE FROM fixed_costs WHERE id = 1').run()
  expect((await db.prepare('SELECT * FROM fixed_cost_splits').all()).results).toHaveLength(0)
})
