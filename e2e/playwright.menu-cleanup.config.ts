import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 全世帯の過去週を削除するため、通常E2Eと同時実行しない。
// 通常と同じ専用ローカルD1を、run-e2e.mjsで実行前後に作り直す。
export default defineConfig({
  ...base,
  testMatch: '**/menu-entry-cleanup-api.spec.ts',
  testIgnore: [],
  workers: 1,
  projects: [{ name: 'menu-cleanup-chromium', use: { browserName: 'chromium' } }],
  webServer: Array.isArray(base.webServer)
    ? base.webServer.map((server, index) => index === 0 ? {
      ...server,
      command: 'npx wrangler d1 migrations apply homelog-db --local --config ../e2e/wrangler.menu-cleanup.toml --persist-to .wrangler/e2e-state && npx wrangler dev --local --config ../e2e/wrangler.menu-cleanup.toml --port 8787 --persist-to .wrangler/e2e-state --test-scheduled',
    } : server)
    : base.webServer,
})
