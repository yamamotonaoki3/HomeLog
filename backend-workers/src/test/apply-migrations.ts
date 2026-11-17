import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import { beforeEach } from 'vitest'

interface TestEnv {
  DB: D1Database
  TEST_MIGRATIONS: D1Migration[]
}

const testEnv = env as unknown as TestEnv

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)

// 回数制限(#510)の回数は、テストの間で持ち越さない(同じメールアドレス・同じ利用者IDを多くのテストが使うため)。
beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM rate_limit_counters').run()
})
