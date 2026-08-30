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
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsPath) },
      },
    }),
  ],
}))
