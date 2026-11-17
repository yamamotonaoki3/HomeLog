import { expect, test } from '@playwright/test'

// デモ環境(DEMO_MODE=true)のAPI層の確認(#532)。画面は使わず request だけで行う。
// デモ利用者は架空のデモ太郎・デモ花子で、メールは example.com の予約ドメイン。作ったデモは24時間で期限切れになる。
interface Tokens { accessToken: string; refreshToken: string }

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

test('デモを始めて2人を切り替え、止めるAPIは403を返す', async ({ request }) => {
  const availability = await request.get('/api/demo')
  expect(await availability.json()).toEqual({ enabled: true })

  const started = await request.post('/api/demo/start')
  expect(started.status()).toBe(201)
  const taro = (await started.json()) as Tokens

  const names = async (path: string, token: string, key: string) =>
    ((await (await request.get(path, { headers: auth(token) })).json()) as Array<Record<string, string>>).map((row) => row[key]).sort()

  expect(await names('/api/accounts', taro.accessToken, 'name')).toEqual(['みどり銀行'])
  const taroStock = await names('/api/inventory-items', taro.accessToken, 'name')
  expect(taroStock).toContain('卵')

  const switched = await request.post('/api/demo/switch', { headers: auth(taro.accessToken), data: { refreshToken: taro.refreshToken } })
  expect(switched.status()).toBe(200)
  const hanako = (await switched.json()) as Tokens
  expect(await names('/api/accounts', hanako.accessToken, 'name')).toEqual(['さくら銀行', '交通系IC'].sort())
  expect(await names('/api/inventory-items', hanako.accessToken, 'name')).toEqual(taroStock)

  // 切り替え前のリフレッシュトークンは失効している。
  const refreshed = await request.post('/api/auth/refresh', { data: { refreshToken: taro.refreshToken } })
  expect(refreshed.status()).toBe(401)

  const register = await request.post('/api/auth/register', {
    data: { email: 'e2euser_demo_blocked@example.com', password: 'TestPass123!', displayName: 'E2EUser Demo' },
  })
  expect(register.status()).toBe(403)
  expect(await register.json()).toMatchObject({ code: 'DEMO_DISABLED', message: 'デモでは使えません' })
})
