import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RATE_LIMITS,
  consumePasswordResetQuota,
  purgePasswordResetAttempts,
  resolveMailMode,
  sendPasswordResetMail,
  signMailRequest,
} from '../../lib/password-reset-mail'

// 実在しない鍵・URL。実GASには接続せず、fetchをモックして境界を検証する。
const GAS_URL = 'https://script.google.com/macros/s/test-deployment-id/exec'
const SECRET = 'test-only-shared-secret-0123456789abcdef'
const mailEnv = { PASSWORD_RESET_MAIL_ENABLED: 'true', PASSWORD_RESET_GAS_URL: GAS_URL, PASSWORD_RESET_GAS_SECRET: SECRET }

describe('resolveMailMode', () => {
  it('停止スイッチがtrueで、URLと共通鍵が揃っていればmail', () => {
    expect(resolveMailMode(mailEnv)).toBe('mail')
  })
  it('停止スイッチがtrue以外ならunavailable', () => {
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_MAIL_ENABLED: 'false' })).toBe('unavailable')
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_MAIL_ENABLED: undefined })).toBe('unavailable')
  })
  it('URLまたは共通鍵が欠けているとunavailable', () => {
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_GAS_URL: undefined })).toBe('unavailable')
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_GAS_SECRET: '' })).toBe('unavailable')
  })
  it('呼出先がGoogleのApps Script(https)以外ならunavailable', () => {
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_GAS_URL: 'http://script.google.com/macros/s/x/exec' })).toBe('unavailable')
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_GAS_URL: 'https://attacker.example.com/macros/s/x/exec' })).toBe('unavailable')
    expect(resolveMailMode({ ...mailEnv, PASSWORD_RESET_GAS_URL: 'not a url' })).toBe('unavailable')
  })
  it('メール未設定でもローカル用ログフラグがtrueならdev-log、メール設定済みならmailが優先', () => {
    expect(resolveMailMode({ APP_PASSWORD_RESET_LOG_TOKEN_ENABLED: 'true' })).toBe('dev-log')
    expect(resolveMailMode({ ...mailEnv, APP_PASSWORD_RESET_LOG_TOKEN_ENABLED: 'true' })).toBe('mail')
    expect(resolveMailMode({ APP_PASSWORD_RESET_LOG_TOKEN_ENABLED: 'false' })).toBe('unavailable')
  })
})

describe('signMailRequest', () => {
  it('v1.時刻.要求ID.宛先.トークンに対するHMAC-SHA256(16進)になる', async () => {
    const fields = { timestamp: 1_800_000_000, requestId: '11111111-2222-4333-8444-555555555555', to: 'user@example.com', token: 'tok_ABC-123' }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expected = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('v1.1800000000.11111111-2222-4333-8444-555555555555.user@example.com.tok_ABC-123'))))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await signMailRequest(SECRET, fields)).toBe(expected)
  })
  it('宛先・トークン・時刻のどれかが変わると署名も変わる', async () => {
    const base = { timestamp: 1, requestId: 'r', to: 'a@example.com', token: 't' }
    const sig = await signMailRequest(SECRET, base)
    expect(await signMailRequest(SECRET, { ...base, to: 'b@example.com' })).not.toBe(sig)
    expect(await signMailRequest(SECRET, { ...base, token: 'u' })).not.toBe(sig)
    expect(await signMailRequest(SECRET, { ...base, timestamp: 2 })).not.toBe(sig)
  })
})

describe('sendPasswordResetMail', () => {
  const input = { to: 'user@example.com', token: 'opaque-token-value', requestId: '11111111-2222-4333-8444-555555555555' }
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('署名付きJSONをPOSTし、共通鍵そのものは送らない', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await sendPasswordResetMail(mailEnv, input, 1_800_000_000_000)
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(GAS_URL)
    expect(init.method).toBe('POST')
    const bodyText = init.body as string
    expect(bodyText).not.toContain(SECRET)
    const body = JSON.parse(bodyText) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['requestId', 'signature', 'timestamp', 'to', 'token', 'version'])
    expect(body).toMatchObject({ version: 'v1', timestamp: 1_800_000_000, requestId: input.requestId, to: input.to, token: input.token })
    expect(body.signature).toBe(await signMailRequest(SECRET, { timestamp: 1_800_000_000, requestId: input.requestId, to: input.to, token: input.token }))
  })
  it('GASが{ok:false}を返したら失敗理由をそのコードで分類する', async () => {
    for (const [code, reason] of [['quota', 'quota'], ['signature', 'signature'], ['expired', 'expired'], ['authorization', 'authorization'], ['config', 'config'], ['busy', 'busy'], ['invalid', 'rejected'], ['unknown-code', 'rejected']] as const) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code }), { status: 200 }))
      expect(await sendPasswordResetMail(mailEnv, input)).toEqual({ ok: false, reason })
    }
  })
  it('HTTPエラー・不正なレスポンス・通信失敗・タイムアウトを分類する', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }))
    expect(await sendPasswordResetMail(mailEnv, input)).toEqual({ ok: false, reason: 'http_error' })
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect(await sendPasswordResetMail(mailEnv, input)).toEqual({ ok: false, reason: 'invalid_response' })
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect(await sendPasswordResetMail(mailEnv, input)).toEqual({ ok: false, reason: 'network' })
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    expect(await sendPasswordResetMail(mailEnv, input)).toEqual({ ok: false, reason: 'timeout' })
  })
  it('自動再送しない(失敗しても1回だけ呼ぶ)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'))
    await sendPasswordResetMail(mailEnv, input)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('タイムアウト用のAbortSignalを付ける', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await sendPasswordResetMail(mailEnv, input)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })
})

describe('申請回数制限(D1)', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM password_reset_attempts').run()
  })
  const now = Date.UTC(2026, 10, 2, 3, 0, 0)

  it('同一メールは窓内でRATE_LIMITS.email.limit回まで、超えたら拒否する', async () => {
    const results: boolean[] = []
    for (let i = 0; i < RATE_LIMITS.email.limit + 2; i += 1) {
      results.push(await consumePasswordResetQuota(env.DB, { email: 'a@example.com', ip: `ip-${i}` }, now))
    }
    expect(results.filter(Boolean)).toHaveLength(RATE_LIMITS.email.limit)
    expect(results.slice(RATE_LIMITS.email.limit)).toEqual([false, false])
  })
  it('メールの大文字小文字・前後空白は同じキーとして数える', async () => {
    for (let i = 0; i < RATE_LIMITS.email.limit; i += 1) {
      expect(await consumePasswordResetQuota(env.DB, { email: ' A@Example.com ', ip: `ip-${i}` }, now)).toBe(true)
    }
    expect(await consumePasswordResetQuota(env.DB, { email: 'a@example.com', ip: 'ip-x' }, now)).toBe(false)
  })
  it('同一接続元は窓内でRATE_LIMITS.ip.limit回まで', async () => {
    let allowed = 0
    for (let i = 0; i < RATE_LIMITS.ip.limit + 3; i += 1) {
      if (await consumePasswordResetQuota(env.DB, { email: `u${i}@example.com`, ip: '203.0.113.9' }, now)) allowed += 1
    }
    expect(allowed).toBe(RATE_LIMITS.ip.limit)
  })
  it('アプリ全体の1日の上限を超えたら、別メール・別接続元でも拒否する', async () => {
    let allowed = 0
    for (let i = 0; i < RATE_LIMITS.global.limit + 3; i += 1) {
      if (await consumePasswordResetQuota(env.DB, { email: `u${i}@example.com`, ip: `ip-${i}` }, now)) allowed += 1
    }
    expect(allowed).toBe(RATE_LIMITS.global.limit)
  })
  it('並行して申請しても上限を超えて許可されない(原子的)', async () => {
    const results = await Promise.all(
      Array.from({ length: RATE_LIMITS.email.limit + 5 }, (_, i) => consumePasswordResetQuota(env.DB, { email: 'race@example.com', ip: `ip-${i}` }, now)),
    )
    expect(results.filter(Boolean)).toHaveLength(RATE_LIMITS.email.limit)
  })
  it('窓が替われば再び許可される', async () => {
    for (let i = 0; i < RATE_LIMITS.email.limit; i += 1) await consumePasswordResetQuota(env.DB, { email: 'w@example.com', ip: `ip-${i}` }, now)
    expect(await consumePasswordResetQuota(env.DB, { email: 'w@example.com', ip: 'ip-n' }, now)).toBe(false)
    expect(await consumePasswordResetQuota(env.DB, { email: 'w@example.com', ip: 'ip-n' }, now + RATE_LIMITS.email.windowSeconds * 1000)).toBe(true)
  })
  it('DBにはメールアドレス・IPの実値を保存しない', async () => {
    await consumePasswordResetQuota(env.DB, { email: 'plain@example.com', ip: '198.51.100.7' }, now)
    const rows = await env.DB.prepare('SELECT scope, key_hash FROM password_reset_attempts').all<{ scope: string; key_hash: string }>()
    expect(rows.results.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows.results)).not.toMatch(/plain@example\.com|198\.51\.100\.7/)
  })
  it('保持期間を過ぎた行だけ清掃する', async () => {
    await consumePasswordResetQuota(env.DB, { email: 'old@example.com', ip: 'ip-old' }, now)
    const later = now + 3 * 24 * 60 * 60 * 1000
    await consumePasswordResetQuota(env.DB, { email: 'new@example.com', ip: 'ip-new' }, later)
    const removed = await purgePasswordResetAttempts(env.DB, later)
    expect(removed).toBeGreaterThan(0)
    const rows = await env.DB.prepare('SELECT window_start FROM password_reset_attempts').all<{ window_start: number }>()
    expect(rows.results.every((row) => row.window_start * 1000 > later - 2 * 24 * 60 * 60 * 1000)).toBe(true)
    expect(rows.results.length).toBeGreaterThan(0)
  })
})
