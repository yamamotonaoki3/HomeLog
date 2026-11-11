import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import { RATE_LIMITS, consumeRateLimits } from '../../lib/rate-limit'
import app from '../../index'

// 認証・画像解析のAPIの回数制限(#510)。
// 実在しないメールアドレスと、文書用に予約されたIPアドレス(TEST-NET-3)だけを使う。
const EMAIL = 'taro@example.com'
const PASSWORD = 'TestPass123!'
const ADDRESS = '203.0.113.7'
const TOO_MANY = { code: 'TOO_MANY_REQUESTS', message: '試行回数が多すぎます。しばらく待ってからもう一度お試しください', details: [] }

const json = { 'Content-Type': 'application/json' }
const from = (address: string) => ({ 'CF-Connecting-IP': address })

function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}, testEnv: object = env) {
  return app.request(path, { method, headers: { ...json, ...headers }, body: JSON.stringify(body) }, testEnv)
}
const register = (email: string, headers: Record<string, string> = {}) =>
  send('POST', '/api/auth/register', { email, password: PASSWORD, displayName: 'E2EUser Taro' }, headers)
const login = (email: string, password: string, headers: Record<string, string> = {}) =>
  send('POST', '/api/auth/login', { email, password }, headers)
const cancelDeletion = (email: string, password: string, headers: Record<string, string> = {}) =>
  send('POST', '/api/auth/account/deletion/cancel', { email, password }, headers)

async function registeredUser(email = EMAIL): Promise<{ id: number; headers: Record<string, string> }> {
  const response = await register(email)
  expect(response.status).toBe(201)
  const { id } = await response.json<{ id: number }>()
  return { id, headers: { Authorization: `Bearer ${await signAccessToken(id, env.JWT_SECRET, 900)}` } }
}

async function resetDb() {
  const images = await env.RECIPE_IMAGES.list({ prefix: 'ocr/' })
  if (images.objects.length > 0) await env.RECIPE_IMAGES.delete(images.objects.map((object) => object.key))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM password_reset_tokens'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

beforeEach(async () => {
  // 固定窓の境目をまたいで回数が戻らないよう、窓の途中の時刻に固定する(毎時5分)。
  vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 3_600_000) * 3_600_000 + 5 * 60_000 })
  await resetDb()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ログインの回数制限', () => {
  const limit = RATE_LIMITS.loginEmail.limit

  it('同じメールアドレスでは上限まで通常どおり応答し、超えると正しいパスワードでも429を返す', async () => {
    await registeredUser()
    for (let i = 0; i < limit; i += 1) expect((await login(EMAIL, 'WrongPass999!')).status).toBe(401)
    const blocked = await login(EMAIL, PASSWORD)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(TOO_MANY)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM refresh_tokens').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('上限ちょうどの回数目は、正しいパスワードならログインできる(境界値)', async () => {
    await registeredUser()
    for (let i = 0; i < limit - 1; i += 1) expect((await login(EMAIL, 'WrongPass999!')).status).toBe(401)
    expect((await login(EMAIL, PASSWORD)).status).toBe(200)
  })

  it('登録の無いメールアドレスでも、同じ回数で同じ応答になる(登録有無を漏らさない)', async () => {
    for (let i = 0; i < limit; i += 1) expect((await login('nobody@example.com', 'WrongPass999!')).status).toBe(401)
    const blocked = await login('nobody@example.com', 'WrongPass999!')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(TOO_MANY)
  })

  it('メールアドレスは大文字・小文字を区別せずに数える', async () => {
    for (let i = 0; i < limit; i += 1) expect((await login(i % 2 ? 'Taro@Example.com' : EMAIL, 'WrongPass999!')).status).toBe(401)
    expect((await login('TARO@EXAMPLE.COM', 'WrongPass999!')).status).toBe(429)
  })

  it('ほかのメールアドレスのログインには影響しない', async () => {
    await registeredUser('hanako@example.com')
    for (let i = 0; i <= limit; i += 1) await login(EMAIL, 'WrongPass999!')
    expect((await login('hanako@example.com', PASSWORD)).status).toBe(200)
  })

  it('時間がたって次の窓になると、またログインできる', async () => {
    await registeredUser()
    for (let i = 0; i <= limit; i += 1) await login(EMAIL, 'WrongPass999!')
    expect((await login(EMAIL, PASSWORD)).status).toBe(429)
    vi.setSystemTime(Date.now() + RATE_LIMITS.loginEmail.windowSeconds * 1000)
    expect((await login(EMAIL, PASSWORD)).status).toBe(200)
  })

  it('入力形式の誤り(400)は回数に数えない', async () => {
    await registeredUser()
    for (let i = 0; i <= limit; i += 1) expect((await login('not-an-email', PASSWORD)).status).toBe(400)
    expect((await login(EMAIL, PASSWORD)).status).toBe(200)
  })

  it('同じ接続元からは、メールアドレスを変えても上限を超えると429を返す', async () => {
    const addressLimit = RATE_LIMITS.loginAddress.limit
    for (let i = 0; i < addressLimit; i += 1) expect((await login(`user${i}@example.com`, 'WrongPass999!', from(ADDRESS))).status).toBe(401)
    expect((await login('another@example.com', 'WrongPass999!', from(ADDRESS))).status).toBe(429)
    // 別の接続元は影響を受けない。
    expect((await login('another2@example.com', 'WrongPass999!', from('203.0.113.8'))).status).toBe(401)
  })

  it('接続元を取得できない・ループバックの場合(ローカル開発・テスト)は、接続元単位では制限しない', async () => {
    const addressLimit = RATE_LIMITS.loginAddress.limit
    for (let i = 0; i <= addressLimit; i += 1) expect((await login(`local${i}@example.com`, 'WrongPass999!')).status).toBe(401)
    for (let i = 0; i <= addressLimit; i += 1) expect((await login(`loop${i}@example.com`, 'WrongPass999!', from('127.0.0.1'))).status).toBe(401)
  })

  it('退会の取り消しも、ログインと同じ回数に数える', async () => {
    await registeredUser()
    for (let i = 0; i < limit; i += 1) expect((await cancelDeletion(EMAIL, 'WrongPass999!')).status).toBe(401)
    expect((await cancelDeletion(EMAIL, PASSWORD)).status).toBe(429)
    expect((await login(EMAIL, PASSWORD)).status).toBe(429)
  })
})

describe('新規登録の回数制限', () => {
  const limit = RATE_LIMITS.registerAddress.limit

  it('同じ接続元からは上限まで登録でき、超えると429を返して登録しない', async () => {
    for (let i = 0; i < limit; i += 1) expect((await register(`new${i}@example.com`, from(ADDRESS))).status).toBe(201)
    const blocked = await register('over@example.com', from(ADDRESS))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(TOO_MANY)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()).toEqual({ n: limit })
    // 別の接続元は登録できる。
    expect((await register('other@example.com', from('203.0.113.8'))).status).toBe(201)
  })

  it('入力形式の誤り(400)は回数に数えない', async () => {
    for (let i = 0; i <= limit; i += 1) {
      expect((await send('POST', '/api/auth/register', { email: `bad${i}@example.com`, password: 'short', displayName: 'E2EUser' }, from(ADDRESS))).status).toBe(400)
    }
    expect((await register('ok@example.com', from(ADDRESS))).status).toBe(201)
  })

  it('接続元を取得できない・ループバックの場合(ローカル開発・テスト)は制限しない', async () => {
    for (let i = 0; i <= limit; i += 1) expect((await register(`local${i}@example.com`)).status).toBe(201)
    for (let i = 0; i <= limit; i += 1) expect((await register(`loop${i}@example.com`, from('::1'))).status).toBe(201)
  })
})

describe('現在のパスワードでの再認証の回数制限', () => {
  const limit = RATE_LIMITS.reauthUser.limit
  const changePassword = (headers: Record<string, string>, currentPassword: string) =>
    send('PUT', '/api/auth/password', { currentPassword, newPassword: 'NewPass456!' }, headers)

  it('パスワード変更は上限まで通常どおり応答し、超えると正しいパスワードでも429を返す', async () => {
    const user = await registeredUser()
    for (let i = 0; i < limit; i += 1) expect((await changePassword(user.headers, 'WrongPass999!')).status).toBe(400)
    const blocked = await changePassword(user.headers, PASSWORD)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(TOO_MANY)
    // パスワードは変わっていない(別のメールアドレス枠ではないので、ログインは通常どおりできる)。
    expect((await login(EMAIL, PASSWORD)).status).toBe(200)
  })

  it('メールアドレス変更・退会の申し込みも、同じ利用者の同じ回数に数える', async () => {
    const user = await registeredUser()
    for (let i = 0; i < limit; i += 1) expect((await changePassword(user.headers, 'WrongPass999!')).status).toBe(400)
    expect((await send('PUT', '/api/auth/email', { currentPassword: PASSWORD, newEmail: 'new@example.com' }, user.headers)).status).toBe(429)
    expect((await send('POST', '/api/auth/account/deletion', { currentPassword: PASSWORD }, user.headers)).status).toBe(429)
    expect(await env.DB.prepare('SELECT email, deletion_requested_at AS requested FROM users WHERE id = ?').bind(user.id).first())
      .toEqual({ email: EMAIL, requested: null })
  })

  it('ほかの利用者の再認証には影響しない', async () => {
    const user = await registeredUser()
    const other = await registeredUser('hanako@example.com')
    for (let i = 0; i <= limit; i += 1) await changePassword(user.headers, 'WrongPass999!')
    expect((await changePassword(other.headers, PASSWORD)).status).toBe(200)
  })

  it('入力形式の誤り(400)は回数に数えない', async () => {
    const user = await registeredUser()
    for (let i = 0; i <= limit; i += 1) {
      expect((await send('PUT', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' }, user.headers)).status).toBe(400)
    }
    expect((await changePassword(user.headers, PASSWORD)).status).toBe(200)
  })
})

describe('画像解析の回数制限', () => {
  const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const OCR_LIMITED = { code: 'TOO_MANY_REQUESTS', message: '画像解析の利用回数が1日の上限に達しました。時間をおいて再度お試しください', details: [] }

  async function memberWithHousehold(email: string) {
    const user = await registeredUser(email)
    const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
      .bind('[E2E_TEST] 世帯', `CODE${user.id}000000000000`.slice(0, 16)).first<{ id: number }>()
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household!.id, user.id).run()
    return { ...user, householdId: household!.id }
  }
  function upload(headers: Record<string, string>) {
    const bytes = new Uint8Array(64)
    bytes.set(PNG_HEADER)
    const form = new FormData()
    form.append('file', new File([bytes], 'recipe.png', { type: 'image/png' }))
    return app.request('/api/recipes/ocr/upload', { method: 'POST', headers, body: form }, env)
  }

  it('アップロードは1日の上限まで受け付け、超えると429を返して保存しない', async () => {
    const user = await memberWithHousehold(EMAIL)
    const limit = RATE_LIMITS.ocrUploadUser.limit
    for (let i = 0; i < limit; i += 1) expect((await upload(user.headers)).status).toBe(201)
    const blocked = await upload(user.headers)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(OCR_LIMITED)
    expect((await env.RECIPE_IMAGES.list({ prefix: `ocr/${user.householdId}/` })).objects).toHaveLength(limit)
    // 同じ世帯でも、ほかの利用者は影響を受けない。
    const other = await registeredUser('hanako@example.com')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(user.householdId, other.id).run()
    expect((await upload(other.headers)).status).toBe(201)
  })

  it('形式の誤った画像(400)は回数に数えない', async () => {
    const user = await memberWithHousehold(EMAIL)
    for (let i = 0; i <= RATE_LIMITS.ocrUploadUser.limit; i += 1) {
      const form = new FormData()
      form.append('file', new File([new Uint8Array(16)], 'recipe.png', { type: 'image/png' }))
      expect((await app.request('/api/recipes/ocr/upload', { method: 'POST', headers: user.headers, body: form }, env)).status).toBe(400)
    }
    expect((await upload(user.headers)).status).toBe(201)
  })

  it('解析は1日の上限を超えると429を返し、外部の解析サービスを呼ばない', async () => {
    const user = await memberWithHousehold(EMAIL)
    const key = `ocr/${user.householdId}/00000000-0000-4000-8000-000000000001.png`
    await env.RECIPE_IMAGES.put(key, new Uint8Array(PNG_HEADER))
    // 上限まで使い切った状態を作る。
    for (let i = 0; i < RATE_LIMITS.ocrAnalyzeUser.limit; i += 1) {
      expect(await consumeRateLimits(env.DB, [{ rule: RATE_LIMITS.ocrAnalyzeUser, key: String(user.id) }])).toBe(true)
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const run = vi.fn()
    const blocked = await send('POST', '/api/recipes/ocr/analyze', { key }, user.headers, { ...env, AI: { run }, GOOGLE_VISION_API_KEY: 'test-vision-key' })
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(OCR_LIMITED)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    // 画像は残し、次の窓でもう一度解析できるようにする(24時間後の清掃で消える)。
    expect(await env.RECIPE_IMAGES.head(key)).not.toBeNull()
  })

  it('解析は上限ちょうどの回数目までは実行する(境界値)', async () => {
    const user = await memberWithHousehold(EMAIL)
    const key = `ocr/${user.householdId}/00000000-0000-4000-8000-000000000002.png`
    await env.RECIPE_IMAGES.put(key, new Uint8Array(PNG_HEADER))
    for (let i = 0; i < RATE_LIMITS.ocrAnalyzeUser.limit - 1; i += 1) {
      await consumeRateLimits(env.DB, [{ rule: RATE_LIMITS.ocrAnalyzeUser, key: String(user.id) }])
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: '[E2E_TEST] カレー' } }] }), { status: 200 })))
    const run = vi.fn().mockResolvedValue({ response: { title: '[E2E_TEST] カレー', ingredients: null, steps: null } })
    const response = await send('POST', '/api/recipes/ocr/analyze', { key }, user.headers, { ...env, AI: { run }, GOOGLE_VISION_API_KEY: 'test-vision-key' })
    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
