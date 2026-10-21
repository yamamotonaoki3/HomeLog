import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

const origin = process.env.E2E_WORKERS_API_ORIGIN ?? 'http://127.0.0.1:8787'

async function household(request: APIRequestContext, label: string) {
  expect(new URL(origin).protocol).toBe('http:')
  expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname)
  const user = newUser(label)
  const registered = await request.post(`${origin}/api/auth/register`, { data: user })
  expect(registered.status()).toBe(201)
  const loggedIn = await request.post(`${origin}/api/auth/login`, { data: { email: user.email, password: user.password } })
  expect(loggedIn.status()).toBe(200)
  const { accessToken } = await loggedIn.json()
  const headers = { Authorization: `Bearer ${accessToken}` }
  const created = await request.post(`${origin}/api/households`, { headers, data: { name: '[E2E_TEST] testuser_' + label } })
  expect(created.status()).toBe(201)
  return headers
}

test('実Workersでカテゴリー追加・重複409・自己更新・他世帯分離を確認する', async ({ request }) => {
  const headers = await household(request, 'category_contract')
  const url = `${origin}/api/zaiko-categories`
  const reserved = await request.post(url, { headers, data: { name: ' 野菜　' } })
  expect(reserved.status()).toBe(409)
  const created = await request.post(url, { headers, data: { name: '　[E2E_TEST] 追加カテゴリ ' } })
  expect(created.status()).toBe(201)
  const item = await created.json()
  expect(item).toMatchObject({ name: '[E2E_TEST] 追加カテゴリ', isDefault: false })
  const duplicate = await request.post(url, { headers, data: { name: '[E2E_TEST] 追加カテゴリ' } })
  expect(duplicate.status()).toBe(409)
  expect(await duplicate.json()).toMatchObject({ code: 'DUPLICATE_ZAIKO_CATEGORY_NAME', details: [] })
  const unchanged = await request.patch(`${url}/${item.id}`, { headers, data: { name: item.name } })
  expect(unchanged.status()).toBe(200)
  const list = await request.get(url, { headers })
  expect(list.status()).toBe(200)
  const categories = await list.json()
  expect(categories.filter((category: { name: string }) => category.name === item.name)).toHaveLength(1)
  expect(categories.filter((category: { isDefault: boolean }) => category.isDefault)).toHaveLength(10)
  const secondHeaders = await household(request, 'category_other_household')
  expect((await request.post(url, { headers: secondHeaders, data: { name: item.name } })).status()).toBe(201)
  expect((await request.patch(`${url}/${item.id}`, { headers: secondHeaders, data: { name: '[E2E_TEST] 他世帯' } })).status()).toBe(404)
})

test('実Workersの並行要求でも同名カテゴリーは1件だけ追加される', async ({ request }) => {
  const headers = await household(request, 'category_concurrent')
  const url = `${origin}/api/zaiko-categories`
  const responses = await Promise.all(Array.from({ length: 4 }, () => request.post(url, { headers, data: { name: '[E2E_TEST] 同時カテゴリ' } })))
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409, 409, 409])
  const list = await request.get(url, { headers })
  expect(list.status()).toBe(200)
  expect((await list.json()).filter((category: { name: string }) => category.name === '[E2E_TEST] 同時カテゴリ')).toHaveLength(1)
})
