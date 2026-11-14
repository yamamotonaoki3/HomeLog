import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// DEMO_MODE=true のデモ環境(#532)。通常E2Eと同時実行しない（同じ専用ローカルD1を使う）。
// 接続先は常にローカル(wrangler dev)で、本番・デモ用のCloudflareには接続しない。
export default defineConfig({
  ...base,
  testMatch: '**/demo*.spec.ts',
  testIgnore: [],
  workers: 1,
  projects: [{ name: 'demo-chromium', use: { browserName: 'chromium' } }],
  webServer: Array.isArray(base.webServer)
    ? base.webServer.map((server, index) => index === 0 ? {
      ...server,
      command: `${server.command} --var DEMO_MODE:true`,
    } : server)
    : base.webServer,
})
