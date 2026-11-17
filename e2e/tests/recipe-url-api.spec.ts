import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

// 接続先をローカルWorkersに固定する。正常な外部URLのfrom-url登録は行わない。
const api = 'http://localhost:8787/api'
const invalidSchemeUrl = 'javascript:0'

async function createActor(request: APIRequestContext, label: string) {
  const user = newUser('recipe_url_' + label)
  expect((await request.post(api + '/auth/register', { data: user })).status()).toBe(201)
  const login = await request.post(api + '/auth/login', { data: { email: user.email, password: user.password } })
  expect(login.status()).toBe(200)
  const { accessToken } = await login.json() as { accessToken: string }
  expect(accessToken).toBeTruthy()
  const headers = { Authorization: `Bearer ${accessToken}` }
  const household = await request.post(api + '/households', {
    headers, data: { name: '[E2E_TEST] recipe URL ' + label },
  })
  expect(household.status()).toBe(201)
  return headers
}

// fixtureは既存npm testの前後cleanupでE2E専用ローカルD1ごと後始末する。
test.describe('レシピURL登録のローカルAPI契約 (#569)', () => {
  test('未認証のfrom-url登録を401で拒否する', async ({ page, request, consoleGuard }) => {
    consoleGuard.watch(page)
    // 認証ガードが退行しても外部取得先を持たない入力にする。
    const response = await request.post(api + '/recipes/from-url', { data: { url: invalidSchemeUrl } })
    expect(response.status()).toBe(401)
  })

  test('認証済みでもHTTP(S)以外のschemeは400で拒否し保存しない', async ({ page, request, consoleGuard }) => {
    consoleGuard.watch(page)
    const headers = await createActor(request, 'invalid')
    const response = await request.post(api + '/recipes/from-url', { headers, data: { url: invalidSchemeUrl } })
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    const list = await request.get(api + '/recipes', { headers })
    expect(list.status()).toBe(200)
    expect(await list.json()).toEqual([])
  })

  test('手動登録を画像nullで保存・取得し別世帯へ公開しない', async ({ page, request, consoleGuard }) => {
    consoleGuard.watch(page)
    const ownerHeaders = await createActor(request, 'owner')
    const otherHeaders = await createActor(request, 'other')
    const data = { title: '[E2E_TEST] ローカルレシピ', ingredients: '[E2E_TEST] 架空の材料', steps: '[E2E_TEST] 架空の手順' }
    const created = await request.post(api + '/recipes', { headers: ownerHeaders, data })
    expect(created.status()).toBe(201)
    const recipe = await created.json() as { id: number }
    const saved = { ...data, id: recipe.id, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null }
    expect(recipe).toMatchObject(saved)

    const ownList = await request.get(api + '/recipes', { headers: ownerHeaders })
    expect(ownList.status()).toBe(200)
    expect(await ownList.json()).toEqual([expect.objectContaining(saved)])
    const otherList = await request.get(api + '/recipes', { headers: otherHeaders })
    expect(otherList.status()).toBe(200)
    expect(await otherList.json()).toEqual([])
  })
})
