import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const port = Number(process.env.E2E_FRONTEND_PORT || 5173)

// production build二版と実Service Workerで検証する。通常suiteと同じ専用D1なので直列実行する。
export default defineConfig({
  ...base,
  testMatch: '**/pwa-update.spec.ts',
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  projects: [{ name: 'pwa-chromium', use: { browserName: 'chromium' } }],
  use: { ...base.use, baseURL: `http://localhost:${port}`, serviceWorkers: 'allow', viewport: { width: 320, height: 844 }, hasTouch: true, trace: 'off' },
  webServer: [
    ...(Array.isArray(base.webServer) ? [base.webServer[0]] : []),
    { command: 'node tests/support/pwa-server.mjs', port, reuseExistingServer: false, timeout: 120_000 },
  ],
})
