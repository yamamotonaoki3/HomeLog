import { expect, test } from '@playwright/test'

test('トップページ(ログイン画面)が表示される', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'HomeLog' })).toBeVisible()
})

test('backend-workersのヘルスチェックが200を返す', async ({ request }) => {
  const response = await request.get('http://localhost:8787/health')

  expect(response.status()).toBe(200)
  await expect(response.json()).resolves.toEqual({ status: 'ok' })
})
