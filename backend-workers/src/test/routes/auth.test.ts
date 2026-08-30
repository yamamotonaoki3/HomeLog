import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateOpaqueToken, sha256Hex } from '../../lib/crypto'
import app from '../../index'

// password-reset/requestはメール送信基盤が無いため生トークンをレスポンスに含めない(Java実装と同じ設計)。
// confirmエンドポイント単体をテストするため、DBに直接有効なトークンを発行するテスト用ヘルパーを用意する。
async function issuePasswordResetTokenForTest(email: string): Promise<string> {
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>()
  if (!user) {
    throw new Error(`test setup error: user not found for ${email}`)
  }
  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .bind(user.id, await sha256Hex(token), expiresAt)
    .run()
  return token
}

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function registerUser(email = 'taro@example.com', password = 'TestPass123!') {
  return app.request(
    '/api/auth/register',
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
  it('201で登録でき、レスポンスにid/email/displayNameを含む', async () => {
    const res = await registerUser()
    expect(res.status).toBe(201)

    const body = await res.json<{ id: number; email: string; displayName: string }>()
    expect(body.id).toBeGreaterThan(0)
    expect(body.email).toBe('taro@example.com')
    expect(body.displayName).toBe('E2EUser Taro')
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
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email', password: 'short', displayName: '' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('パスワードが数字のみ(英字を含まない)の場合は400を返す', async () => {
    const res = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: '12345678', displayName: 'E2EUser Taro' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('表示名が空白のみの場合は400を返す', async () => {
    const res = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: 'TestPass123!', displayName: '   ' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('表示名が51文字以上の場合は400を返す', async () => {
    const res = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: 'TestPass123!', displayName: 'a'.repeat(51) }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('不正なJSONボディでは400を返す(500にならない)', async () => {
    const res = await app.request(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json',
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
      '/api/auth/login',
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
      '/api/auth/login',
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
      '/api/auth/login',
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
    '/api/auth/login',
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
      '/api/auth/refresh',
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
      '/api/auth/refresh',
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
  it('204を返し、そのリフレッシュトークンではrefreshできなくなる', async () => {
    const { refreshToken } = await loginAndGetTokens()

    const logoutRes = await app.request(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      env,
    )
    expect(logoutRes.status).toBe(204)

    const refreshRes = await app.request(
      '/api/auth/refresh',
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
      '/api/auth/password-reset/request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com' }),
      },
      env,
    )
    const notExistingRes = await app.request(
      '/api/auth/password-reset/request',
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
      '/api/auth/password-reset/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-token', newPassword: 'NewPass123!' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('有効なトークンで新しいパスワードに変更でき、以後は新パスワードでログインできる', async () => {
    await registerUser()
    const resetToken = await issuePasswordResetTokenForTest('taro@example.com')

    const confirmRes = await app.request(
      '/api/auth/password-reset/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: 'NewPass456!' }),
      },
      env,
    )
    expect(confirmRes.status).toBe(200)

    const loginRes = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'taro@example.com', password: 'NewPass456!' }),
      },
      env,
    )
    expect(loginRes.status).toBe(200)
  })
})
