import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function registerUser(email = 'taro@example.com', password = 'TestPass123!') {
  return app.request(
    '/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName: 'E2EUser Taro' }),
    },
    env,
  )
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /auth/register', () => {
  it('201で登録できる', async () => {
    const res = await registerUser()
    expect(res.status).toBe(201)
  })

  it('メールアドレス重複時は409を返す', async () => {
    await registerUser()
    const res = await registerUser()

    expect(res.status).toBe(409)
    const body = await res.json<{ code?: string; message?: string }>()
    expect(body.message).toBeTruthy()
  })

  it('バリデーションエラー時は400を返す', async () => {
    const res = await app.request(
      '/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email', password: 'short', displayName: '' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('POST /auth/login', () => {
  it('正しい認証情報でトークンを発行する', async () => {
    await registerUser()

    const res = await app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: 'TestPass123!' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ accessToken: string; refreshToken: string; expiresIn: number }>()
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.expiresIn).toBeGreaterThan(0)
  })

  it('誤ったパスワードでは401を返す', async () => {
    await registerUser()

    const res = await app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: 'WrongPass123!' }),
      },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('存在しないメールアドレスでは401を返す', async () => {
    const res = await app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'TestPass123!' }),
      },
      env,
    )

    expect(res.status).toBe(401)
  })
})

async function loginAndGetTokens() {
  await registerUser()
  const res = await app.request(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com', password: 'TestPass123!' }),
    },
    env,
  )
  return res.json<{ accessToken: string; refreshToken: string; expiresIn: number }>()
}

describe('POST /auth/refresh', () => {
  it('有効なリフレッシュトークンで新しいアクセストークンを発行する', async () => {
    const { refreshToken } = await loginAndGetTokens()

    const res = await app.request(
      '/auth/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ accessToken: string; expiresIn: number }>()
    expect(body.accessToken).toBeTruthy()
  })

  it('不正なリフレッシュトークンでは401を返す', async () => {
    const res = await app.request(
      '/auth/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'invalid-token' }),
      },
      env,
    )

    expect(res.status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('ログアウト後、そのリフレッシュトークンではrefreshできない', async () => {
    const { refreshToken } = await loginAndGetTokens()

    const logoutRes = await app.request(
      '/auth/logout',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      env,
    )
    expect(logoutRes.status).toBe(200)

    const refreshRes = await app.request(
      '/auth/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      env,
    )
    expect(refreshRes.status).toBe(401)
  })
})

describe('POST /auth/password-reset/request', () => {
  it('存在するメールアドレスでも存在しないメールアドレスでも同じレスポンスを返す(enumeration対策)', async () => {
    await registerUser()

    const existingRes = await app.request(
      '/auth/password-reset/request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com' }),
      },
      env,
    )
    const notExistingRes = await app.request(
      '/auth/password-reset/request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com' }),
      },
      env,
    )

    expect(existingRes.status).toBe(notExistingRes.status)
    const existingBody = await existingRes.json<{ message: string }>()
    const notExistingBody = await notExistingRes.json<{ message: string }>()
    expect(existingBody.message).toBe(notExistingBody.message)
  })
})

describe('POST /auth/password-reset/confirm', () => {
  it('不正なトークンでは400を返す', async () => {
    const res = await app.request(
      '/auth/password-reset/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-token', newPassword: 'NewPass123!' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})
