import { defineConfig } from '@playwright/test'

// E2E専用のローカルD1保存先。開発用データ(.wrangler/state)とは分離し、実行ごとに作り直す。
// 接続先は常にローカル(wrangler dev)であり、本番・ステージングのDBには接続しない。
const E2E_PERSIST_DIR = '.wrangler/e2e-state'
const BACKEND_PORT = 8787
const FRONTEND_PORT = 5173

export default defineConfig({
  testDir: './tests',
  // 世帯参加など複数ユーザーを跨ぐシナリオはテスト内で完結させ、テスト間は独立させる
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './tests/support/global-setup.ts',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `npx wrangler d1 migrations apply homelog-db --local --persist-to ${E2E_PERSIST_DIR} && npx wrangler dev --port ${BACKEND_PORT} --persist-to ${E2E_PERSIST_DIR}`,
      cwd: '../backend-workers',
      port: BACKEND_PORT,
      reuseExistingServer: false, // 開発用DBを掴んだ既存サーバーを再利用しない
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: '../frontend',
      port: FRONTEND_PORT,
      reuseExistingServer: false, // 開発用DBを掴んだ既存サーバーを再利用しない
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
    },
  ],
})
