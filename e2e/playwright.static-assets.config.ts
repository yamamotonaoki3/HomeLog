import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 実Workers単独で配信する。通常E2Eと同時実行しない（同じ専用D1を利用）。
export default defineConfig({
  ...base,
  testMatch: '**/static-assets.spec.ts',
  testIgnore: [],
  projects: [{ name: 'static-chromium', use: { browserName: 'chromium' } }],
  use: { ...base.use, baseURL: 'http://localhost:8787', serviceWorkers: 'block' },
  webServer: Array.isArray(base.webServer) ? [base.webServer[0]] : base.webServer,
})
