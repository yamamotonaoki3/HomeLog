import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITS } from '../../lib/password-reset-mail'
import app from '../../index'

// 実在しない鍵・URL・メールアドレスのみ。実GASや実メールには接続せず、fetchをモックする。
const GAS_URL = 'https://script.google.com/macros/s/test-deployment-id/exec'
const SECRET = 'test-only-shared-secret-0123456789abcdef'
const mailEnv = { ...env, PASSWORD_RESET_MAIL_ENABLED: 'true', PASSWORD_RESET_GAS_URL: GAS_URL, PASSWORD_RESET_GAS_SECRET: SECRET }
const devLogEnv = { ...env, APP_PASSWORD_RESET_LOG_TOKEN_ENABLED: 'true' }
const EMAIL = 'taro@example.com'

const json = { 'Content-Type': 'application/json' }

function post(path: string, body: unknown, testEnv: object = env, headers: Record<string, string> = {}) {
  return app.request(path, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) }, testEnv)
}
const requestReset = (email: string, testEnv: object = env, headers: Record<string, string> = {}) =>
  post('/api/auth/password-reset/request', { email }, testEnv, headers)
const confirmReset = (token: string, newPassword = 'NewPass456!') => post('/api/auth/password-reset/confirm', { token, newPassword })

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_reset_attempts'),
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function registerUser(email = EMAIL) {
  const res = await post('/api/auth/register', { email, password: 'TestPass123!', displayName: 'E2EUser Taro' })
  expect(res.status).toBe(201)
}

let fetchMock: ReturnType<typeof vi.fn>
const sentBodies = () => fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string) as { to: string; token: string; requestId: string })

beforeEach(async () => {
  await resetDb()
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /auth/password-reset/availability', () => {
  it('未設定・停止中はavailable=falseで、キャッシュさせない', async () => {
    const res = await app.request('/api/auth/password-reset/availability', {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: false })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
  it('メール送信が有効で設定が揃っていればavailable=true(認証不要)', async () => {
    const res = await app.request('/api/auth/password-reset/availability', {}, mailEnv)
    expect(await res.json()).toEqual({ available: true })
  })
  it('ローカル用ログフラグだけでもavailable=true、停止スイッチfalseの本番設定ではfalse', async () => {
    expect(await (await app.request('/api/auth/password-reset/availability', {}, devLogEnv)).json()).toEqual({ available: true })
    expect(await (await app.request('/api/auth/password-reset/availability', {}, { ...mailEnv, PASSWORD_RESET_MAIL_ENABLED: 'false' })).json()).toEqual({ available: false })
  })
  it('availabilityの応答に設定値(URL・共通鍵)を含めない', async () => {
    const text = await (await app.request('/api/auth/password-reset/availability', {}, mailEnv)).text()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('script.google.com')
  })
})

describe('POST /auth/password-reset/request: 利用不可', () => {
  it('未設定・停止中は、登録有無に関わらず同じ503を返し、トークンも作らない', async () => {
    await registerUser()
    const registered = await requestReset(EMAIL)
    const unknown = await requestReset('nobody@example.com')
    expect(registered.status).toBe(503)
    expect(unknown.status).toBe(503)
    const a = await registered.json<{ code: string }>()
    expect(a).toEqual(await unknown.json())
    expect(a.code).toBe('PASSWORD_RESET_UNAVAILABLE')
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').first<{ n: number }>()
    expect(count?.n).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('利用不可のときは、不正なメール形式でも同じ503を返す(回数も消費しない)', async () => {
    const res = await requestReset('not-an-email')
    expect(res.status).toBe(503)
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_attempts').first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })
  it('共通鍵だけ欠けている設定でも503', async () => {
    await registerUser()
    const res = await requestReset(EMAIL, { ...mailEnv, PASSWORD_RESET_GAS_SECRET: undefined })
    expect(res.status).toBe(503)
  })
})

describe('POST /auth/password-reset/request: メール送信', () => {
  it('登録済みアドレスにはGASへ署名付き要求を1回送り、送信完了とは断定しない同じ200を返す', async () => {
    await registerUser()
    const res = await requestReset(EMAIL, mailEnv)
    expect(res.status).toBe(200)
    const { message } = await res.json<{ message: string }>()
    expect(message).not.toMatch(/送信しました/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [body] = sentBodies()
    expect(body.to).toBe(EMAIL)
    expect(body.token.length).toBeGreaterThanOrEqual(20)
    expect((await confirmReset(body.token)).status).toBe(200)
  })
  it('未登録アドレスではGASを呼ばず、登録済みと同じステータス・本文を返す', async () => {
    await registerUser()
    const registered = await requestReset(EMAIL, mailEnv)
    const unknown = await requestReset('nobody@example.com', mailEnv)
    expect(unknown.status).toBe(registered.status)
    expect(await unknown.json()).toEqual(await registered.json())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('GASが失敗・タイムアウトしても応答は同じ200で、届いている可能性のあるリンクは期限内なら使える', async () => {
    await registerUser()
    fetchMock.mockImplementationOnce(async () => { throw new DOMException('timeout', 'TimeoutError') })
    const res = await requestReset(EMAIL, mailEnv)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 自動再送しない
    const [body] = sentBodies()
    expect((await confirmReset(body.token)).status).toBe(200)
  })
  it('GASが枠不足を返しても、利用者へは存在・失敗を漏らさず同じ200を返す', async () => {
    await registerUser()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'quota' }), { status: 200 }))
    const res = await requestReset(EMAIL, mailEnv)
    expect(res.status).toBe(200)
  })
  it('再申請すると以前のリンクは無効になり、最新のリンクだけが使える', async () => {
    await registerUser()
    await requestReset(EMAIL, mailEnv)
    await requestReset(EMAIL, mailEnv)
    const [first, second] = sentBodies()
    expect((await confirmReset(first.token)).status).toBe(400)
    expect((await confirmReset(second.token)).status).toBe(200)
  })
  it('ログへ宛先・トークン・共通鍵・URLを出さない(成功時も失敗時も)', async () => {
    await registerUser()
    const spies = (['log', 'info', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}))
    await requestReset(EMAIL, mailEnv)
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    await requestReset(EMAIL, mailEnv)
    const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => args.map(String).join(' ')).join('\n')
    for (const body of sentBodies()) {
      expect(logged).not.toContain(body.token)
    }
    expect(logged).not.toContain(EMAIL)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain('test-deployment-id')
    expect(logged).toMatch(/network/) // 失敗の分類は残す
  })
  it('生トークンをレスポンス本文へ含めない', async () => {
    await registerUser()
    const text = await (await requestReset(EMAIL, mailEnv)).text()
    expect(text).not.toContain(sentBodies()[0].token)
  })
})

describe('POST /auth/password-reset/request: 回数制限', () => {
  it('同一メールの上限を超えると、登録有無に関わらず429を返しGASも呼ばない', async () => {
    await registerUser()
    for (let i = 0; i < RATE_LIMITS.email.limit; i += 1) {
      expect((await requestReset(EMAIL, mailEnv, { 'CF-Connecting-IP': `198.51.100.${i + 1}` })).status).toBe(200)
    }
    const registered = await requestReset(EMAIL, mailEnv, { 'CF-Connecting-IP': '198.51.100.99' })
    expect(registered.status).toBe(429)
    const registeredBody = await registered.json<{ code: string }>()
    expect(registeredBody.code).toBe('PASSWORD_RESET_RATE_LIMITED')
    expect(fetchMock).toHaveBeenCalledTimes(RATE_LIMITS.email.limit)

    // 未登録アドレスでも同じ回数で同じ429になる(存在が漏れない)
    for (let i = 0; i < RATE_LIMITS.email.limit; i += 1) {
      expect((await requestReset('nobody@example.com', mailEnv, { 'CF-Connecting-IP': `198.51.101.${i + 1}` })).status).toBe(200)
    }
    const unknown = await requestReset('nobody@example.com', mailEnv, { 'CF-Connecting-IP': '198.51.101.99' })
    expect(unknown.status).toBe(429)
    expect(await unknown.json()).toEqual(registeredBody)
  })
  it('同一接続元の上限を超えると、別のメールでも429になる', async () => {
    for (let i = 0; i < RATE_LIMITS.ip.limit; i += 1) {
      expect((await requestReset(`user${i}@example.com`, mailEnv, { 'CF-Connecting-IP': '203.0.113.5' })).status).toBe(200)
    }
    expect((await requestReset('another@example.com', mailEnv, { 'CF-Connecting-IP': '203.0.113.5' })).status).toBe(429)
  })
  it('429のときは新しいトークンを発行せず、既存の有効リンクを無効にしない', async () => {
    await registerUser()
    await requestReset(EMAIL, mailEnv, { 'CF-Connecting-IP': '198.51.100.1' })
    const [first] = sentBodies()
    for (let i = 0; i < RATE_LIMITS.email.limit; i += 1) await requestReset(EMAIL, mailEnv, { 'CF-Connecting-IP': `198.51.100.${i + 10}` })
    const countBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').first<{ n: number }>()
    expect((await requestReset(EMAIL, mailEnv, { 'CF-Connecting-IP': '198.51.100.200' })).status).toBe(429)
    const countAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').first<{ n: number }>()
    expect(countAfter?.n).toBe(countBefore?.n)
    // 最新(3回目)のリンクは使える。1回目は再申請で無効
    const latest = sentBodies().at(-1)!
    expect((await confirmReset(first.token)).status).toBe(400)
    expect((await confirmReset(latest.token)).status).toBe(200)
  })
  it('不正なメール形式は400で、回数制限を消費しない', async () => {
    const res = await requestReset('not-an-email', mailEnv)
    expect(res.status).toBe(400)
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_reset_attempts').first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })
})

describe('POST /auth/password-reset/request: ローカル用ログ経路', () => {
  it('メールを送らず、生トークンだけをログへ出す(宛先は出さない)。そのトークンでconfirmできる', async () => {
    await registerUser()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await requestReset(EMAIL, devLogEnv)
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    const logged = [...warn.mock.calls, ...info.mock.calls].map((args) => args.join(' ')).join('\n')
    expect(logged).not.toContain(EMAIL)
    const token = logged.match(/token=(\S+)/)?.[1]
    expect(token).toBeTruthy()
    expect((await confirmReset(token!)).status).toBe(200)
  })
})

describe('POST /auth/password-reset/confirm: トークン整合性', () => {
  async function issue(email = EMAIL): Promise<string> {
    await requestReset(email, mailEnv)
    return sentBodies().at(-1)!.token
  }
  async function loginStatus(password: string) {
    return (await post('/api/auth/login', { email: EMAIL, password })).status
  }

  it('期限切れトークンは400で、パスワードは変わらない', async () => {
    await registerUser()
    const token = await issue()
    await env.DB.prepare('UPDATE password_reset_tokens SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run()
    expect((await confirmReset(token)).status).toBe(400)
    expect(await loginStatus('TestPass123!')).toBe(200)
  })
  it('新規発行したトークンの有効期限は約30分', async () => {
    await registerUser()
    await issue()
    const row = await env.DB.prepare('SELECT expires_at FROM password_reset_tokens').first<{ expires_at: string }>()
    const minutes = (new Date(row!.expires_at).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(29)
    expect(minutes).toBeLessThanOrEqual(30)
  })
  it('DBにはトークンのハッシュだけを保存し、生トークンは保存しない', async () => {
    await registerUser()
    const token = await issue()
    const rows = await env.DB.prepare('SELECT token_hash FROM password_reset_tokens').all<{ token_hash: string }>()
    expect(rows.results.map((row) => row.token_hash)).not.toContain(token)
  })
  it('使用済みトークンの再送は400で、新しいパスワード・セッションを変更しない', async () => {
    await registerUser()
    const token = await issue()
    expect((await confirmReset(token, 'FirstPass123!')).status).toBe(200)
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE revoked_at IS NULL').first<{ n: number }>()
    expect((await confirmReset(token, 'SecondPass456!')).status).toBe(400)
    expect(await loginStatus('FirstPass123!')).toBe(200)
    expect(await loginStatus('SecondPass456!')).toBe(401)
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE revoked_at IS NULL').first<{ n: number }>()
    // 上のloginで1件増えるだけ。再送の400では増えない
    expect(after?.n).toBe((sessions?.n ?? 0) + 1)
  })
  it('同じトークンの同時確定は1件だけ成功する', async () => {
    await registerUser()
    const token = await issue()
    const results = await Promise.all([confirmReset(token, 'ConcurrentA123!'), confirmReset(token, 'ConcurrentB123!'), confirmReset(token, 'ConcurrentC123!')])
    expect(results.filter((res) => res.status === 200)).toHaveLength(1)
  })
  it('確定すると既存のリフレッシュトークンをすべて失効させる', async () => {
    await registerUser()
    const login = await post('/api/auth/login', { email: EMAIL, password: 'TestPass123!' })
    const { refreshToken } = await login.json<{ refreshToken: string }>()
    const token = await issue()
    expect((await confirmReset(token)).status).toBe(200)
    expect((await post('/api/auth/refresh', { refreshToken })).status).toBe(401)
  })
})
