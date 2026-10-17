import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../index'

const PASSWORD = 'TestPass123!'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM users WHERE email LIKE ?').bind('testuser_account%'),
  ])
}

async function request(path: string, method: string, body?: unknown, token?: string) {
  return app.request(`/api/auth/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
}

async function login(email: string, password = PASSWORD) {
  return request('login', 'POST', { email, password })
}

async function signUp(email = 'testuser_account_a@example.com') {
  expect((await request('register', 'POST', { email, password: PASSWORD, displayName: 'テスト太郎' })).status).toBe(201)
  const res = await login(email)
  return res.json<{ accessToken: string; refreshToken: string }>()
}

beforeEach(resetDb)

describe('GET /api/auth/account', () => {
  it('本人の表示名とメールアドレスを返す', async () => {
    const { accessToken } = await signUp()
    const res = await request('account', 'GET', undefined, accessToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: expect.any(Number), email: 'testuser_account_a@example.com', displayName: 'テスト太郎' })
  })

  it('未認証は401', async () => {
    expect((await request('account', 'GET')).status).toBe(401)
  })
})

describe('PATCH /api/auth/account', () => {
  it.each(['a', '名'.repeat(50), '  前後に空白  ', ` ${'名'.repeat(50)} `])('表示名を変更できる (%s)', async (displayName) => {
    const { accessToken } = await signUp()
    const res = await request('account', 'PATCH', { displayName }, accessToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ displayName: displayName.trim() })
    expect(await (await request('me', 'GET', undefined, accessToken)).json()).toMatchObject({ displayName: displayName.trim() })
  })

  it.each([{ displayName: '' }, { displayName: '   ' }, { displayName: '名'.repeat(51) }, {}, { displayName: 1 }])('不正な表示名は400 (%j)', async (body) => {
    const { accessToken } = await signUp()
    const res = await request('account', 'PATCH', body, accessToken)
    expect(res.status).toBe(400)
    expect(await (await request('me', 'GET', undefined, accessToken)).json()).toMatchObject({ displayName: 'テスト太郎' })
  })

  it('未認証は401', async () => {
    expect((await request('account', 'PATCH', { displayName: 'x' })).status).toBe(401)
  })
})

describe('PUT /api/auth/password', () => {
  it('現在のパスワードで再認証して変更し、今の端末以外のリフレッシュトークンを失効させる', async () => {
    const current = await signUp()
    const other = await (await login('testuser_account_a@example.com')).json<{ refreshToken: string }>()
    const res = await request('password', 'PUT', { currentPassword: PASSWORD, newPassword: 'NewPass456', refreshToken: current.refreshToken }, current.accessToken)
    expect(res.status).toBe(200)
    expect((await login('testuser_account_a@example.com')).status).toBe(401)
    expect((await login('testuser_account_a@example.com', 'NewPass456')).status).toBe(200)
    expect((await request('refresh', 'POST', { refreshToken: current.refreshToken })).status).toBe(200)
    expect((await request('refresh', 'POST', { refreshToken: other.refreshToken })).status).toBe(401)
  })

  it('現在のパスワードが違うときは400で変更しない', async () => {
    const { accessToken } = await signUp()
    const res = await request('password', 'PUT', { currentPassword: 'WrongPass1', newPassword: 'NewPass456' }, accessToken)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', message: '現在のパスワードが正しくありません' })
    expect((await login('testuser_account_a@example.com')).status).toBe(200)
  })

  it.each(['short1', 'abcdefgh', '12345678', ''])('新しいパスワードが規則に合わないときは400 (%s)', async (newPassword) => {
    const { accessToken } = await signUp()
    expect((await request('password', 'PUT', { currentPassword: PASSWORD, newPassword }, accessToken)).status).toBe(400)
  })

  it('他人のリフレッシュトークンを渡しても失効対象から外れない(自分のトークンだけを残す)', async () => {
    const a = await signUp()
    const b = await signUp('testuser_account_b@example.com')
    const res = await request('password', 'PUT', { currentPassword: PASSWORD, newPassword: 'NewPass456', refreshToken: b.refreshToken }, a.accessToken)
    expect(res.status).toBe(200)
    expect((await request('refresh', 'POST', { refreshToken: a.refreshToken })).status).toBe(401)
    expect((await request('refresh', 'POST', { refreshToken: b.refreshToken })).status).toBe(200)
  })

  it('未認証は401', async () => {
    expect((await request('password', 'PUT', { currentPassword: PASSWORD, newPassword: 'NewPass456' })).status).toBe(401)
  })
})

describe('PUT /api/auth/email', () => {
  it('現在のパスワードで再認証して変更し、新しいアドレスでログインできる', async () => {
    const { accessToken } = await signUp()
    const res = await request('email', 'PUT', { currentPassword: PASSWORD, newEmail: 'testuser_account_new@example.com' }, accessToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ email: 'testuser_account_new@example.com' })
    expect((await login('testuser_account_a@example.com')).status).toBe(401)
    expect((await login('testuser_account_new@example.com')).status).toBe(200)
  })

  it('現在のパスワードが違うときは400で変更しない', async () => {
    const { accessToken } = await signUp()
    const res = await request('email', 'PUT', { currentPassword: 'WrongPass1', newEmail: 'testuser_account_new@example.com' }, accessToken)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', message: '現在のパスワードが正しくありません' })
    expect((await login('testuser_account_a@example.com')).status).toBe(200)
  })

  it('他のユーザーが使っているアドレスは409', async () => {
    await signUp('testuser_account_b@example.com')
    const { accessToken } = await signUp()
    const res = await request('email', 'PUT', { currentPassword: PASSWORD, newEmail: 'testuser_account_b@example.com' }, accessToken)
    expect(res.status).toBe(409)
  })

  it.each(['not-an-email', '', 'a@'])('不正なアドレスは400 (%s)', async (newEmail) => {
    const { accessToken } = await signUp()
    expect((await request('email', 'PUT', { currentPassword: PASSWORD, newEmail }, accessToken)).status).toBe(400)
  })

  it('未認証は401', async () => {
    expect((await request('email', 'PUT', { currentPassword: PASSWORD, newEmail: 'testuser_account_new@example.com' })).status).toBe(401)
  })
})

describe('認証情報の変更とパスワード再設定トークン', () => {
  async function issueResetToken(userId: number) {
    await env.DB.prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, 'testuser_hash', ?)")
      .bind(userId, new Date(Date.now() + 600_000).toISOString()).run()
  }
  const unused = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE used_at IS NULL').first<{ n: number }>())!.n

  it.each([
    ['password', { currentPassword: PASSWORD, newPassword: 'NewPass456' }],
    ['email', { currentPassword: PASSWORD, newEmail: 'testuser_account_new@example.com' }],
  ] as const)('%s を変更すると、発行済みの再設定トークンを無効にする', async (path, body) => {
    const { accessToken } = await signUp()
    const { id } = await (await request('account', 'GET', undefined, accessToken)).json<{ id: number }>()
    await issueResetToken(id)
    expect(await unused()).toBe(1)
    expect((await request(path, 'PUT', body, accessToken)).status).toBe(200)
    expect(await unused()).toBe(0)
  })
})

