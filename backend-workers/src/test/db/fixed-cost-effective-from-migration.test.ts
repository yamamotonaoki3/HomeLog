import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('0024 は既存の固定費の有効開始日をマイグレーション適用日(JST)にし、金額や支払日を変えない', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as { MIGRATION_DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
  const migration = migrations.find((m) => m.name.startsWith('0024'))!
  expect(migration).toBeDefined()
  await applyD1Migrations(db, migrations.filter((m) => m.name < migration.name))
  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash, display_name) VALUES (1, 'migration-fixed@example.com', 'dummy-hash', 'testuser_396')"),
    db.prepare("INSERT INTO households (id, name, invite_code) VALUES (1, '[E2E_TEST] migration', 'testuser_396')"),
    db.prepare("INSERT INTO fixed_costs (id, household_id, created_by_user_id, name, amount, payment_day) VALUES (1, 1, 1, '[E2E_TEST] rent', 80000, 5)"),
  ])
  const before = await db.prepare('SELECT id, household_id, name, amount, payment_day, created_at FROM fixed_costs WHERE id = 1').first()

  await applyD1Migrations(db, [migration])

  const after = await db.prepare('SELECT id, household_id, name, amount, payment_day, created_at, effective_from FROM fixed_costs WHERE id = 1').first<Record<string, unknown>>()
  const { effective_from: effectiveFrom, ...rest } = after!
  expect(rest).toEqual(before)
  const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  expect(effectiveFrom).toBe(jstToday)
  // 以降の直接INSERT(履歴なし)はNULLのまま。回収対象にはしない。
  await db.prepare("INSERT INTO fixed_costs (id, household_id, created_by_user_id, name, amount, payment_day) VALUES (2, 1, 1, '[E2E_TEST] later', 100, 1)").run()
  expect(await db.prepare('SELECT effective_from FROM fixed_costs WHERE id = 2').first()).toEqual({ effective_from: null })
})
