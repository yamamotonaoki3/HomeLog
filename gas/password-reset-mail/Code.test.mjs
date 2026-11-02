// GAS中継の境界テスト。実GAS・実メールには接続せず、Apps Scriptのグローバルを模擬して検証する。
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('./Code.js', import.meta.url), 'utf8')
const SECRET = 'test-only-shared-secret-0123456789abcdef'
const APP_URL = 'https://homelog.example.com'
const NOW_MS = 1_800_000_000_000
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN-_0123'

function createRuntime({ props = { SHARED_SECRET: SECRET, APP_URL }, quota = 100, lockAcquired = true, sendError = false } = {}) {
  const sent = []
  const cacheStore = new Map()
  const logs = []
  const record = (...args) => logs.push(args.map(String).join(' '))
  const sandbox = {
    console: { error: record, log: record },
    Date: class extends Date { static now() { return NOW_MS } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ text, setMimeType() { return this } }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => props[key] ?? null }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => cacheStore.set(k, v), remove: (k) => cacheStore.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAcquired, releaseLock() {} }) },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (message) => { if (sendError) throw new Error('boom'); sent.push(message) },
    },
    Utilities: {
      // Apps Scriptは符号付きバイト配列を返す。
      computeHmacSha256Signature: (payload, key) => Array.from(createHmac('sha256', key).update(payload).digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  const post = (body) => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text)
  return { sandbox, sent, logs, post, cacheStore }
}

function signed(overrides = {}) {
  const fields = { version: 'v1', timestamp: NOW_MS / 1000, requestId: randomUUID(), to: 'user@example.com', token: TOKEN, ...overrides }
  const signature = createHmac('sha256', SECRET).update(`${fields.version}.${fields.timestamp}.${fields.requestId}.${fields.to}.${fields.token}`).digest('hex')
  return { ...fields, signature: overrides.signature ?? signature }
}

describe('正規の署名付き要求', () => {
  it('固定の件名・本文・アプリURLのリンクでメールを1通送る', () => {
    const { post, sent } = createRuntime()
    assert.deepEqual(post(signed()), { ok: true })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'user@example.com')
    assert.equal(sent[0].subject, '【シェファミ】パスワード再設定のご案内')
    assert.match(sent[0].body, new RegExp(`${APP_URL}/password-reset#token=${TOKEN}\\n`))
    assert.equal(sent[0].subject.includes(TOKEN), false)
    assert.equal(sent[0].noReply, true)
  })
  it('APP_URLの末尾スラッシュがあってもリンクは二重にならない', () => {
    const { post, sent } = createRuntime({ props: { SHARED_SECRET: SECRET, APP_URL: `${APP_URL}/` } })
    post(signed())
    assert.match(sent[0].body, new RegExp(`${APP_URL}/password-reset#token=`))
    assert.equal(sent[0].body.includes('//password-reset'), false)
  })
})

describe('拒否すべき要求(メールを送らない)', () => {
  let rt
  beforeEach(() => { rt = createRuntime() })

  it('署名が違う', () => {
    assert.deepEqual(rt.post(signed({ signature: 'a'.repeat(64) })), { ok: false, code: 'signature' })
    assert.equal(rt.sent.length, 0)
  })
  it('宛先・トークン・時刻を改ざんすると署名が合わない', () => {
    assert.equal(rt.post({ ...signed(), to: 'other@example.com' }).code, 'signature')
    assert.equal(rt.post({ ...signed(), token: `${TOKEN}x` }).code, 'signature')
    const original = signed()
    assert.equal(rt.post({ ...original, timestamp: original.timestamp + 1 }).code, 'signature')
    assert.equal(rt.sent.length, 0)
  })
  it('許容時間(±300秒)を外れた要求は期限切れ', () => {
    assert.deepEqual(rt.post(signed({ timestamp: NOW_MS / 1000 - 301 })), { ok: false, code: 'expired' })
    assert.deepEqual(rt.post(signed({ timestamp: NOW_MS / 1000 + 301 })), { ok: false, code: 'expired' })
    assert.equal(rt.post(signed({ timestamp: NOW_MS / 1000 - 300 })).ok, true)
  })
  it('余分な項目(件名・本文・リンクの上書き)や欠けた項目は形式不正', () => {
    assert.equal(rt.post({ ...signed(), subject: 'x' }).code, 'invalid')
    assert.equal(rt.post({ ...signed(), body: 'x' }).code, 'invalid')
    assert.equal(rt.post({ ...signed(), url: 'https://attacker.example.com' }).code, 'invalid')
    const missing = signed()
    delete missing.token
    assert.equal(rt.post(missing).code, 'invalid')
    assert.equal(rt.sent.length, 0)
  })
  it('形式が不正(JSONでない・バージョン違い・宛先/トークン/要求ID/時刻の形式)', () => {
    assert.equal(rt.post('not json').code, 'invalid')
    assert.equal(rt.post('[]').code, 'invalid')
    assert.equal(rt.post(signed({ version: 'v2' })).code, 'invalid')
    assert.equal(rt.post(signed({ to: 'a@example.com\nBcc: x@example.com' })).code, 'invalid')
    assert.equal(rt.post(signed({ to: 'not-an-email' })).code, 'invalid')
    assert.equal(rt.post(signed({ token: 'short' })).code, 'invalid')
    assert.equal(rt.post(signed({ token: `${TOKEN}<script>` })).code, 'invalid')
    assert.equal(rt.post(signed({ requestId: 'not-a-uuid' })).code, 'invalid')
    assert.equal(rt.post(signed({ timestamp: '1800000000' })).code, 'invalid')
    assert.equal(rt.post(signed({ timestamp: 1.5 })).code, 'invalid')
    assert.equal(rt.sent.length, 0)
  })
  it('極端に大きな本文は読まない', () => {
    assert.equal(rt.post(JSON.stringify({ ...signed(), pad: 'x'.repeat(3000) })).code, 'invalid')
  })
  it('GETは何も送らない', () => {
    assert.deepEqual(JSON.parse(rt.sandbox.doGet().text), { ok: false, code: 'method' })
    assert.equal(rt.sent.length, 0)
  })
})

describe('設定・運用', () => {
  it('SHARED_SECRETまたはAPP_URLが未設定、APP_URLがhttpsでなければ設定エラー', () => {
    const cases = [{ APP_URL }, { SHARED_SECRET: SECRET }, { SHARED_SECRET: SECRET, APP_URL: 'http://homelog.example.com' }, { SHARED_SECRET: SECRET, APP_URL: 'javascript:alert(1)' }]
    for (const props of cases) {
      const rt = createRuntime({ props })
      assert.deepEqual(rt.post(signed()), { ok: false, code: 'config' })
      assert.equal(rt.sent.length, 0)
    }
  })
  it('同じ要求IDの再送は2通目を送らず、成功として返す', () => {
    const rt = createRuntime()
    const request = signed()
    assert.deepEqual(rt.post(request), { ok: true })
    assert.deepEqual(rt.post(request), { ok: true, duplicate: true })
    assert.equal(rt.sent.length, 1)
  })
  it('ロックを取れなければbusyで、送らない', () => {
    const rt = createRuntime({ lockAcquired: false })
    assert.deepEqual(rt.post(signed()), { ok: false, code: 'busy' })
    assert.equal(rt.sent.length, 0)
  })
  it('1日の残り枠が無ければquotaで、送らない', () => {
    const rt = createRuntime({ quota: 0 })
    assert.deepEqual(rt.post(signed()), { ok: false, code: 'quota' })
    assert.equal(rt.sent.length, 0)
  })
  it('送信権限の失効などで送信が例外になったらauthorizationを返し、重複検出の記録は残さない', () => {
    const rt = createRuntime({ sendError: true })
    assert.deepEqual(rt.post(signed()), { ok: false, code: 'authorization' })
    assert.equal(rt.cacheStore.size, 0)
  })
  it('ログに宛先・トークン・共通鍵・リンクを出さない', () => {
    const rt = createRuntime({ sendError: true })
    rt.post(signed())
    rt.post('broken')
    const logged = rt.logs.join('\n')
    for (const value of ['user@example.com', TOKEN, SECRET, APP_URL]) assert.equal(logged.includes(value), false)
  })
  it('想定外の例外でも内部情報を返さない', () => {
    const rt = createRuntime()
    rt.sandbox.PropertiesService = { getScriptProperties: () => { throw new Error('secret-detail') } }
    const result = rt.post(signed())
    assert.deepEqual(result, { ok: false, code: 'internal' })
    assert.equal(rt.logs.join('\n').includes('secret-detail'), false)
  })
})
