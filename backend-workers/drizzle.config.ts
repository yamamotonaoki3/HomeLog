import { defineConfig } from 'drizzle-kit'

// Phase 1以降、既存Flywayマイグレーション相当のスキーマ定義をsrc/db/schema.tsに追加していく。
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'd1-http',
})
