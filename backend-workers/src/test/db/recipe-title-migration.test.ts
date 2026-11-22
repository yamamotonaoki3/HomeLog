import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('既存の同じタイトルのレシピを保持して新しい重複だけを防ぐ', async () => {
  const { MIGRATION_DB: db, TEST_MIGRATIONS: migrations } = env as unknown as {
    MIGRATION_DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  await applyD1Migrations(db, migrations.filter(migration => migration.name < '0033'))
  const title = '[E2E_TEST] 既存の料理'
  await db.batch([
    db.prepare("INSERT INTO users(id,email,password_hash,display_name) VALUES(1,'testuser_recipe_migration@example.com','dummy','testuser_recipe_migration')"),
    db.prepare("INSERT INTO households(id,name,invite_code) VALUES(1,'[E2E_TEST] recipe migration','testuser_599')"),
    db.prepare('INSERT INTO recipes(id,household_id,created_by_user_id,title) VALUES(1,1,1,?),(2,1,1,?)').bind(title, '　' + title),
  ])
  const recipes = () => db.prepare('SELECT id, title, ingredients FROM recipes ORDER BY id').all()
  const before = (await recipes()).results
  await applyD1Migrations(db, migrations)
  expect((await recipes()).results).toEqual(before)

  await db.prepare('UPDATE recipes SET title = ?, ingredients = ? WHERE id = 2').bind(title, '[E2E_TEST] 材料').run()
  await expect(db.prepare('INSERT INTO recipes(household_id,created_by_user_id,title) VALUES(1,1,?)').bind(title).run())
    .rejects.toThrow(/HOMELOG_RECIPE_TITLE_CONFLICT/)
  expect((await recipes()).results).toEqual([before[0], { id: 2, title, ingredients: '[E2E_TEST] 材料' }])
})
