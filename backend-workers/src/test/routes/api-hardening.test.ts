import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

// 入力の大きさの上限と、API応答の安全用ヘッダー(#512)。実在しないメールアドレスだけを使う。
const json = { 'Content-Type': 'application/json' }
const MAX_JSON_BODY_BYTES = 100 * 1024
const MAX_RECIPE_TEXT = 10_000

async function resetDb() {
  const images = await env.RECIPE_IMAGES.list({ prefix: 'ocr/' })
  if (images.objects.length > 0) await env.RECIPE_IMAGES.delete(images.objects.map((object) => object.key))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM refresh_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function memberHeaders(): Promise<Record<string, string>> {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind('taro@example.com', 'dummy-hash', 'E2EUser Taro').first<{ id: number }>()
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('[E2E_TEST] 世帯', `CODE${user!.id}000000000000`.slice(0, 16)).first<{ id: number }>()
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household!.id, user!.id).run()
  return { Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 900)}` }
}

beforeEach(resetDb)

describe('API応答の安全用ヘッダー', () => {
  function expectSecurityHeaders(response: Response) {
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }

  it('成功の応答に付く(登録 201・ヘルスチェック 200)', async () => {
    const registered = await app.request('/api/auth/register', {
      method: 'POST', headers: json, body: JSON.stringify({ email: 'hanako@example.com', password: 'TestPass123!', displayName: 'E2EUser Hanako' }),
    }, env)
    expect(registered.status).toBe(201)
    expectSecurityHeaders(registered)
    const health = await app.request('/health', {}, env)
    expect(health.status).toBe(200)
    expectSecurityHeaders(health)
  })

  it('エラーの応答にも付く(認証エラー 401・入力エラー 400・存在しないAPI 404・本文が大きすぎる 413)', async () => {
    const unauthorized = await app.request('/api/auth/me', {}, env)
    expect(unauthorized.status).toBe(401)
    expectSecurityHeaders(unauthorized)
    const invalid = await app.request('/api/auth/login', { method: 'POST', headers: json, body: '{}' }, env)
    expect(invalid.status).toBe(400)
    expectSecurityHeaders(invalid)
    const missing = await app.request('/api/unknown-endpoint', {}, env)
    expect(missing.status).toBe(404)
    expectSecurityHeaders(missing)
    const tooLarge = await app.request('/api/auth/login', { method: 'POST', headers: json, body: 'x'.repeat(MAX_JSON_BODY_BYTES + 1) }, env)
    expect(tooLarge.status).toBe(413)
    expectSecurityHeaders(tooLarge)
  })

  it('認証済みの一覧取得の応答にも付き、ブラウザや中継に残さない', async () => {
    const headers = await memberHeaders()
    const response = await app.request('/api/recipes', { headers }, env)
    expect(response.status).toBe(200)
    expectSecurityHeaders(response)
  })
})

describe('リクエスト本文の大きさの上限', () => {
  // 本文全体がちょうど bytes バイトになるログイン要求を作る。
  function loginBody(bytes: number): string {
    const base = JSON.stringify({ email: 'nobody@example.com', password: '' })
    return JSON.stringify({ email: 'nobody@example.com', password: 'x'.repeat(bytes - base.length) })
  }

  it('上限ちょうどの本文は受け付け、通常の処理へ進む(境界値)', async () => {
    const body = loginBody(MAX_JSON_BODY_BYTES)
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_JSON_BODY_BYTES)
    const response = await app.request('/api/auth/login', { method: 'POST', headers: json, body }, env)
    expect(response.status).toBe(401)
  })

  it('上限を1バイトでも超える本文は413を共通形式で返し、処理しない', async () => {
    const response = await app.request('/api/auth/login', { method: 'POST', headers: json, body: loginBody(MAX_JSON_BODY_BYTES + 1) }, env)
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ code: 'VALIDATION_ERROR', message: '送信された内容が大きすぎます', details: [] })
  })

  it('Content-Lengthで上限超えを申告した要求も413を返す', async () => {
    const response = await app.request('/api/auth/login', {
      method: 'POST', headers: { ...json, 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) }, body: loginBody(MAX_JSON_BODY_BYTES + 1),
    }, env)
    expect(response.status).toBe(413)
  })

  it('画像のアップロードは、この上限の対象外(既存の5MBの上限のまま)', async () => {
    const headers = await memberHeaders()
    const bytes = new Uint8Array(MAX_JSON_BODY_BYTES * 3)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const form = new FormData()
    form.append('file', new File([bytes], 'recipe.png', { type: 'image/png' }))
    const response = await app.request('/api/recipes/ocr/upload', { method: 'POST', headers, body: form }, env)
    expect(response.status).toBe(201)
  })
})

describe('レシピの材料・手順の文字数の上限', () => {
  const post = (headers: Record<string, string>, body: unknown) =>
    app.request('/api/recipes', { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) }, env)

  it('材料・手順はそれぞれ上限ちょうどまで登録できる(境界値)', async () => {
    const headers = await memberHeaders()
    const response = await post(headers, { title: '[E2E_TEST] 長いレシピ', ingredients: 'あ'.repeat(MAX_RECIPE_TEXT), steps: 'い'.repeat(MAX_RECIPE_TEXT) })
    expect(response.status).toBe(201)
    const saved = await response.json<{ ingredients: string; steps: string }>()
    expect(saved.ingredients).toHaveLength(MAX_RECIPE_TEXT)
    expect(saved.steps).toHaveLength(MAX_RECIPE_TEXT)
  })

  it.each([
    ['材料', { ingredients: 'あ'.repeat(MAX_RECIPE_TEXT + 1), steps: null }],
    ['手順', { ingredients: null, steps: 'い'.repeat(MAX_RECIPE_TEXT + 1) }],
  ])('%sが上限を1文字でも超えると400を返し、登録しない', async (_label, fields) => {
    const headers = await memberHeaders()
    const response = await post(headers, { title: '[E2E_TEST] 長すぎるレシピ', ...fields })
    expect(response.status).toBe(400)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM recipes').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('編集でも同じ上限を適用し、超えると元の内容を変えない', async () => {
    const headers = await memberHeaders()
    const created = await (await post(headers, { title: '[E2E_TEST] レシピ', ingredients: '材料', steps: '手順' })).json<{ id: number }>()
    const patch = (body: unknown) => app.request(`/api/recipes/${created.id}`, { method: 'PATCH', headers: { ...json, ...headers }, body: JSON.stringify(body) }, env)
    expect((await patch({ title: '[E2E_TEST] レシピ', ingredients: 'あ'.repeat(MAX_RECIPE_TEXT + 1), steps: '手順' })).status).toBe(400)
    expect(await env.DB.prepare('SELECT ingredients FROM recipes WHERE id = ?').bind(created.id).first()).toEqual({ ingredients: '材料' })
    expect((await patch({ title: '[E2E_TEST] レシピ', ingredients: 'あ'.repeat(MAX_RECIPE_TEXT), steps: '手順' })).status).toBe(200)
  })
})
