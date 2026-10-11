import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

// PNGファイルの先頭8バイト(マジックナンバー)。拡張子やContent-Typeの偽装を見抜くために使う。
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0]

function pngFile(size = 64): File {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_HEADER)
  return new File([bytes], 'recipe.png', { type: 'image/png' })
}

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recipes'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUser(email: string, withHousehold = true): Promise<{ householdId: number | null; headers: Record<string, string> }> {
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
    .bind(email, 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  let householdId: number | null = null
  if (withHousehold) {
    const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
      .bind('テスト世帯', `CODE${user.id}00000000000`.slice(0, 16))
      .first<{ id: number }>()
    if (!household) throw new Error('test setup error')
    await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').bind(household.id, user.id).run()
    householdId = household.id
  }
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { householdId, headers: { Authorization: `Bearer ${token}` } }
}

async function upload(headers: Record<string, string>, file: File | null) {
  const form = new FormData()
  if (file) form.append('file', file)
  return app.request('/api/recipes/ocr/upload', { method: 'POST', headers, body: form }, env)
}

// Workers AIは模擬版が無いため、テストでは決まった応答を返す偽物(モック)に差し替える。
function testEnv(aiResponse: unknown, apiKey: string | null = 'test-vision-key') {
  const run = vi.fn().mockResolvedValue(aiResponse)
  return { env: { ...env, AI: { run }, GOOGLE_VISION_API_KEY: apiKey ?? undefined }, run }
}

function visionResponse(text: string | null): Response {
  const body = text === null ? { responses: [{}] } : { responses: [{ fullTextAnnotation: { text } }] }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function analyze(headers: Record<string, string>, body: unknown, overrideEnv: object) {
  return app.request(
    '/api/recipes/ocr/analyze',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    overrideEnv,
  )
}

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/recipes/ocr/upload', () => {
  it('未認証は401を返す', async () => {
    const form = new FormData()
    form.append('file', pngFile())
    const res = await app.request('/api/recipes/ocr/upload', { method: 'POST', body: form }, env)
    expect(res.status).toBe(401)
  })

  it('PNG画像をR2に保存し、世帯ごとの一時keyを返す', async () => {
    const { householdId, headers } = await createUser('testuser_ocr_upload@example.com')
    const res = await upload(headers, pngFile())

    expect(res.status).toBe(201)
    const body = await res.json<{ key: string }>()
    expect(body.key).toMatch(new RegExp(`^ocr/${householdId}/[0-9a-f-]{36}\\.png$`))
    const stored = await env.RECIPE_IMAGES.get(body.key)
    expect(stored).not.toBeNull()
    expect(stored?.httpMetadata?.contentType).toBe('image/png')
    await stored?.arrayBuffer()
  })

  it('JPEG画像も受け付ける', async () => {
    const { headers } = await createUser('testuser_ocr_jpeg@example.com')
    const bytes = new Uint8Array(64)
    bytes.set(JPEG_HEADER)
    const res = await upload(headers, new File([bytes], 'recipe.jpg', { type: 'image/jpeg' }))
    expect(res.status).toBe(201)
    expect((await res.json<{ key: string }>()).key).toMatch(/\.jpg$/)
  })

  it('ファイルが無い場合は400を返す', async () => {
    const { headers } = await createUser('testuser_ocr_nofile@example.com')
    expect((await upload(headers, null)).status).toBe(400)
  })

  it('対応していない形式(GIF)は400を返す', async () => {
    const { headers } = await createUser('testuser_ocr_gif@example.com')
    const res = await upload(headers, new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], 'a.gif', { type: 'image/gif' }))
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe('VALIDATION_ERROR')
  })

  it('Content-Typeと中身が一致しない場合は400を返す', async () => {
    const { headers } = await createUser('testuser_ocr_fake@example.com')
    const res = await upload(headers, new File([new TextEncoder().encode('not an image')], 'fake.png', { type: 'image/png' }))
    expect(res.status).toBe(400)
  })

  it('5MBちょうどは受け付け、5MBを超えると400を返す', async () => {
    const { headers } = await createUser('testuser_ocr_size@example.com')
    expect((await upload(headers, pngFile(5 * 1024 * 1024))).status).toBe(201)
    expect((await upload(headers, pngFile(5 * 1024 * 1024 + 1))).status).toBe(400)
  })

  it('世帯未所属は404を返す', async () => {
    const { headers } = await createUser('testuser_ocr_nohousehold@example.com', false)
    expect((await upload(headers, pngFile())).status).toBe(404)
  })

  it('リクエストボディの上限を超える場合は413を返し、R2に保存しない', async () => {
    const { householdId, headers } = await createUser('testuser_ocr_body_limit@example.com')
    const res = await upload(headers, pngFile(5 * 1024 * 1024 + 128 * 1024))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '画像はJPEG・PNG・WebP形式、5MB以下のファイルを選択してください',
      details: [],
    })
    expect((await env.RECIPE_IMAGES.list({ prefix: `ocr/${householdId}/` })).objects).toEqual([])
  })
})

describe('POST /api/recipes/ocr/analyze', () => {
  async function uploaded(email: string) {
    const user = await createUser(email)
    const res = await upload(user.headers, pngFile())
    const { key } = await res.json<{ key: string }>()
    return { ...user, key }
  }

  it('画像をVisionで文字にし、Workers AIで構造化した結果をDBに保存せず返し、画像を削除する', async () => {
    const { headers, key } = await uploaded('testuser_ocr_analyze@example.com')
    const fetchMock = vi.fn().mockResolvedValue(visionResponse('肉じゃが\n材料 じゃがいも 3個\n手順 煮る'))
    vi.stubGlobal('fetch', fetchMock)
    const { env: overrideEnv, run } = testEnv({
      response: { title: '肉じゃが', ingredients: 'じゃがいも 3個', steps: '煮る' },
    })

    const res = await analyze(headers, { key }, overrideEnv)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: '肉じゃが',
      ingredients: 'じゃがいも 3個',
      steps: '煮る',
      rawText: '肉じゃが\n材料 じゃがいも 3個\n手順 煮る',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://vision.googleapis.com/v1/images:annotate')
    expect(url).not.toContain('key=')
    expect(new Headers(init.headers).get('X-goog-api-key')).toBe('test-vision-key')
    expect(String(init.body)).toContain('DOCUMENT_TEXT_DETECTION')
    expect(run).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(run.mock.calls[0])).toContain('肉じゃが')
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM recipes').first<{ n: number }>()
    expect(count?.n).toBe(0)
    expect(await env.RECIPE_IMAGES.head(key)).toBeNull()
  })

  it('AIの応答が文字列のJSONでも構造化結果として扱う', async () => {
    const { headers, key } = await uploaded('testuser_ocr_string@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse('カレー')))
    const { env: overrideEnv } = testEnv({ response: JSON.stringify({ title: 'カレー', ingredients: null, steps: null }) })

    const res = await analyze(headers, { key }, overrideEnv)
    expect(await res.json()).toEqual({ title: 'カレー', ingredients: null, steps: null, rawText: 'カレー' })
  })

  it('AIの応答が想定の形でない場合は、読み取った文字を手順欄に入れて返す', async () => {
    const { headers, key } = await uploaded('testuser_ocr_fallback@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse('読み取った文字')))
    const { env: overrideEnv } = testEnv({ response: 'これはJSONではありません' })

    const res = await analyze(headers, { key }, overrideEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: '', ingredients: null, steps: '読み取った文字', rawText: '読み取った文字' })
  })

  it('AIの呼び出しが失敗した場合も、読み取った文字を手順欄に入れて返す', async () => {
    const { headers, key } = await uploaded('testuser_ocr_aierror@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse('読み取った文字')))
    const overrideEnv = { ...env, AI: { run: vi.fn().mockRejectedValue(new Error('ai down')) }, GOOGLE_VISION_API_KEY: 'k' }

    const res = await analyze(headers, { key }, overrideEnv)
    expect(res.status).toBe(200)
    expect((await res.json<{ steps: string }>()).steps).toBe('読み取った文字')
  })

  it('文字を読み取れなかった場合は400を返し、AIは呼ばない', async () => {
    const { headers, key } = await uploaded('testuser_ocr_notext@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(visionResponse(null)))
    const { env: overrideEnv, run } = testEnv({ response: {} })

    const res = await analyze(headers, { key }, overrideEnv)
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    expect(await env.RECIPE_IMAGES.head(key)).toBeNull()
  })

  it('Visionがエラーを返した場合は502を返す', async () => {
    const { headers, key } = await uploaded('testuser_ocr_visionerror@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 403 })))
    const { env: overrideEnv } = testEnv({ response: {} })

    const res = await analyze(headers, { key }, overrideEnv)
    expect(res.status).toBe(502)
    expect((await res.json<{ code: string }>()).code).toBe('EXTERNAL_SERVICE_ERROR')
  })

  it.each([false, true])('VisionがHTTP 200でerrorを返す場合は502になり画像を削除する(文字あり: %s)', async (withText) => {
    const { headers, key } = await uploaded('testuser_ocr_vision_body_error@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ responses: [{
      error: { code: 8, message: 'quota exceeded' },
      ...(withText ? { fullTextAnnotation: { text: '[E2E_TEST] 読み取り結果' } } : {}),
    }] })))
    const { env: overrideEnv, run } = testEnv({ response: {} })

    const res = await analyze(headers, { key }, overrideEnv)
    expect(res.status).toBe(502)
    expect((await res.json<{ code: string }>()).code).toBe('EXTERNAL_SERVICE_ERROR')
    expect(run).not.toHaveBeenCalled()
    expect(await env.RECIPE_IMAGES.head(key)).toBeNull()
  })

  it('APIキーが未設定の場合は外部APIを呼ばず502を返す', async () => {
    const { headers, key } = await uploaded('testuser_ocr_nokey@example.com')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { env: overrideEnv } = testEnv({ response: {} }, null)

    expect((await analyze(headers, { key }, overrideEnv)).status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('他世帯の画像keyは404を返し、画像は残す', async () => {
    const owner = await uploaded('testuser_ocr_owner@example.com')
    const other = await createUser('testuser_ocr_other@example.com')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { env: overrideEnv } = testEnv({ response: {} })

    expect((await analyze(other.headers, { key: owner.key }, overrideEnv)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await env.RECIPE_IMAGES.head(owner.key)).not.toBeNull()
  })

  it('存在しないkeyは404を返す', async () => {
    const { householdId, headers } = await createUser('testuser_ocr_missing@example.com')
    const { env: overrideEnv } = testEnv({ response: {} })
    const res = await analyze(headers, { key: `ocr/${householdId}/00000000-0000-0000-0000-000000000000.png` }, overrideEnv)
    expect(res.status).toBe(404)
  })

  it('keyが無い・形式が不正な場合は400を返す', async () => {
    const { householdId, headers } = await createUser('testuser_ocr_badkey@example.com')
    const { env: overrideEnv } = testEnv({ response: {} })
    expect((await analyze(headers, {}, overrideEnv)).status).toBe(400)
    expect((await analyze(headers, { key: `ocr/${householdId}/../x.png` }, overrideEnv)).status).toBe(400)
  })
})

describe('POST /api/recipes (sourceType)', () => {
  it('sourceType=ocrで保存できる', async () => {
    const { headers } = await createUser('testuser_ocr_save@example.com')
    const res = await app.request(
      '/api/recipes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ title: '[E2E_TEST] OCRレシピ', ingredients: 'にんじん', steps: '切る', sourceType: 'ocr' }),
      },
      env,
    )
    expect(res.status).toBe(201)
    expect((await res.json<{ sourceType: string }>()).sourceType).toBe('ocr')
  })

  it('sourceType=webは400を返す(WEBレシピはfrom-url専用)', async () => {
    const { headers } = await createUser('testuser_ocr_web@example.com')
    const res = await app.request(
      '/api/recipes',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: 'x', sourceType: 'web' }) },
      env,
    )
    expect(res.status).toBe(400)
  })
})
