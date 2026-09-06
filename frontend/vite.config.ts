/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  plugins: [
    react(),
    // Web Share Target連携(共有ボタン経由でレシピURLを受け取る、F-09参照)のためのPWA化。
    // manifest自体は`generateManifest: false`にせず本体を生成させ、share_targetのみ
    // manifestオプションで追加する(injectManifest等の高度な構成は不要なため`generateSW`戦略)。
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'HomeLog',
        short_name: 'HomeLog',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        // Web App Manifest仕様のプロパティ名(share_target)に合わせるためsnake_caseのまま使う。
        share_target: {
          action: '/recipes/share',
          method: 'GET',
          params: { url: 'url', text: 'text', title: 'title' },
        },
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
