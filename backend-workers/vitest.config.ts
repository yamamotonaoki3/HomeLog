import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrationsPath = path.join(import.meta.dirname, 'drizzle')

export default defineConfig(async () => ({
  test: {
    setupFiles: ['./src/test/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Workers AI等のリモートバインディングにテストから接続しない(CIに認証情報が無く、課金も発生するため)。
      // AIを使う処理のテストではモックに差し替える。
      remoteBindings: false,
      miniflare: {
        d1Databases: ['DB', 'MIGRATION_DB'],
        bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsPath) },
      },
    }),
  ],
}))
