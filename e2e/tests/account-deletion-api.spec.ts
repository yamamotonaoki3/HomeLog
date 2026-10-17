import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

// 退会API(#297)の契約を、実行中のWorkers経由で確認する。削除処理と境界値はbackend-workersのテストが担当する。
test('退会を申し込むとログインできなくなり、30日以内なら取り消してログインできる', async ({ request }) => {
  const user = newUser('deletion_api')
  expect((await request.post('/api/auth/register', { data: user })).status()).toBe(201)
  const tokens = await (await request.post('/api/auth/login', { data: { email: user.email, password: user.password } })).json()
  const headers = { Authorization: `Bearer ${tokens.accessToken}` }

  expect(await (await request.get('/api/auth/account/deletion-check', { headers })).json()).toEqual({ canRequest: true, unsettledSplits: 0, fixedCostsWithOthers: 0 })
  const requested = await request.post('/api/auth/account/deletion', { headers, data: { currentPassword: user.password } })
  expect(requested.status()).toBe(200)
  const { deletionScheduledAt } = await requested.json()

  expect((await request.get('/api/auth/me', { headers })).status()).toBe(401)
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: tokens.refreshToken } })).status()).toBe(401)
  const pending = await request.post('/api/auth/login', { data: { email: user.email, password: user.password } })
  expect(pending.status()).toBe(403)
  expect(await pending.json()).toMatchObject({ code: 'ACCOUNT_DELETION_PENDING', details: [{ field: 'deletionScheduledAt', reason: deletionScheduledAt }] })

  const cancelled = await request.post('/api/auth/account/deletion/cancel', { data: { email: user.email, password: user.password } })
  expect(cancelled.status()).toBe(200)
  const restored = await cancelled.json()
  expect((await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${restored.accessToken}` } })).status()).toBe(200)
})
