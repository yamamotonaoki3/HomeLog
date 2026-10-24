import { env } from 'cloudflare:test'
import { beforeEach, expect, it, vi } from 'vitest'
import { purgePastMenuEntries } from '../../lib/menu-entry-cleanup'

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM menu_entries'),
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
})

async function seed(weeks: string[], label = 'a') {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(`testuser_cleanup_${label}@example.com`, 'dummy', 'testuser_cleanup').first<{ id: number }>()
  const home = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] cleanup', `cleanup_${label}`).first<{ id: number }>()
  const recipe = await env.DB.prepare('INSERT INTO recipes (household_id, created_by_user_id, title) VALUES (?, ?, ?) RETURNING id')
    .bind(home!.id, user!.id, '[E2E_TEST] recipe').first<{ id: number }>()
  for (const week of weeks) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO menu_entries (household_id, recipe_id, week_start_date) VALUES (?, ?, ?)').bind(home!.id, recipe!.id, week),
      env.DB.prepare('INSERT INTO menu_entries (household_id, free_text_memo, week_start_date) VALUES (?, ?, ?)').bind(home!.id, '[E2E_TEST] memo', week),
    ])
  }
  return recipe!.id
}

async function remainingWeeks() {
  const { results } = await env.DB.prepare('SELECT week_start_date FROM menu_entries ORDER BY week_start_date').all<{ week_start_date: string }>()
  return results.map((row) => row.week_start_date)
}

it('全世帯の過去週だけを削除し、今週・未来と元レシピを保持する', async () => {
  await seed(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
  await seed(['2026-10-19', '2026-10-26'], 'b')
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(6)
  expect(await remainingWeeks()).toEqual(['2026-10-26', '2026-10-26', '2026-10-26', '2026-10-26', '2026-11-02', '2026-11-02'])
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM recipes').first('count')).toBe(2)
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(0)
})

it('JST日曜23:59では今週を残し、月曜0時から削除する', async () => {
  await seed(['2026-10-19', '2026-10-26'])
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T14:59:59.999Z'))).toBe(0)
  expect(await remainingWeeks()).toHaveLength(4)
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(2)
  expect(await remainingWeeks()).toEqual(['2026-10-26', '2026-10-26'])
})

it('年をまたぐ週と長期間停止後の再開でも今週より前だけを削除する', async () => {
  await seed(['2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05'])
  expect(await purgePastMenuEntries(env.DB, new Date('2026-01-01T00:00:00Z'))).toBe(4)
  expect(await remainingWeeks()).toEqual(['2025-12-29', '2025-12-29', '2026-01-05', '2026-01-05'])
  expect(await purgePastMenuEntries(env.DB, new Date('2026-01-04T15:00:00Z'))).toBe(2)
})

it('空DBは0件を返す', async () => {
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(0)
})

it('DB失敗は呼出元へ伝え、次回の実行で削除できる', async () => {
  await seed(['2026-10-19'])
  const failingDb = { prepare: vi.fn(() => { throw new Error('[E2E_TEST] DB failure') }) } as unknown as D1Database
  await expect(purgePastMenuEntries(failingDb, new Date('2026-10-25T15:00:00Z'))).rejects.toThrow('DB failure')
  expect(await remainingWeeks()).toHaveLength(2)
  expect(await purgePastMenuEntries(env.DB, new Date('2026-10-25T15:00:00Z'))).toBe(2)
})
