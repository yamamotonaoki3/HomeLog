import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

// アカウント設定API(#291)の契約を、実行中のWorkers経由で確認する。境界値・認可の網羅はbackend-workersのテストが担当する。
test('表示名・パスワード・メールアドレスを変更でき、変更後の認証情報でログインできる', async ({ request }) => {
  const user = newUser('account_api')
  expect((await request.post('/api/auth/register', { data: user })).status()).toBe(201)
  const login = async (email: string, password: string) => request.post('/api/auth/login', { data: { email, password } })
  const tokens = await (await login(user.email, user.password)).json()
  const headers = { Authorization: `Bearer ${tokens.accessToken}` }

  const account = await request.get('/api/auth/account', { headers })
  expect(account.status()).toBe(200)
  expect(await account.json()).toMatchObject({ email: user.email, displayName: user.displayName })

  const renamed = `${user.displayName}_renamed`
  const patch = await request.patch('/api/auth/account', { headers, data: { displayName: renamed } })
  expect(patch.status()).toBe(200)
  expect(await (await request.get('/api/auth/me', { headers })).json()).toMatchObject({ displayName: renamed })

  const wrong = await request.put('/api/auth/password', { headers, data: { currentPassword: 'WrongPass1', newPassword: 'NewPass456' } })
  expect(wrong.status()).toBe(400)
  const changed = await request.put('/api/auth/password', { headers, data: { currentPassword: user.password, newPassword: 'NewPass456', refreshToken: tokens.refreshToken } })
  expect(changed.status()).toBe(200)
  expect((await login(user.email, user.password)).status()).toBe(401)
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: tokens.refreshToken } })).status()).toBe(200)

  const newEmail = user.email.replace('e2euser_account_api_', 'e2euser_account_api_new_')
  const email = await request.put('/api/auth/email', { headers, data: { currentPassword: 'NewPass456', newEmail } })
  expect(email.status()).toBe(200)
  expect((await login(newEmail, 'NewPass456')).status()).toBe(200)
  expect((await login(user.email, 'NewPass456')).status()).toBe(401)
})
