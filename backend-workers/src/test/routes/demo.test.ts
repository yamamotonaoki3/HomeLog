import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { DEMO_MAX_ACTIVE } from '../../lib/demo'
import { createDemoHousehold } from '../../lib/demo-seed'
import { signAccessToken } from '../../lib/jwt'
import { RATE_LIMITS } from '../../lib/rate-limit'

// デモ環境(#532)。メールは予約ドメイン、接続元は文書用のTEST-NET-3だけを使う。
const demoEnv = { ...env, DEMO_MODE: 'true' }
const json = { 'Content-Type': 'application/json' }

interface Tokens { accessToken: string; refreshToken: string; expiresIn: number }

const call = (method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string>; testEnv?: object } = {}) =>
  app.request(
    path,
    {
      method,
      headers: { ...json, ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    options.testEnv ?? demoEnv,
  )

async function start(headers: Record<string, string> = {}): Promise<Tokens> {
  const res = await call('POST', '/api/demo/start', { headers })
  expect(res.status).toBe(201)
  return res.json<Tokens>()
}

async function list<T = Record<string, unknown>>(path: string, token: string): Promise<T[]> {
  const res = await call('GET', path, { token })
  expect(res.status).toBe(200)
  return res.json<T[]>()
}

const names = (rows: Array<Record<string, unknown>>, key: string) => rows.map((row) => row[key] as string)

async function me(token: string) {
  const res = await call('GET', '/api/auth/me', { token })
  expect(res.status).toBe(200)
  return res.json<{ id: number; displayName: string; demo: unknown }>()
}

async function switchTo(tokens: Tokens): Promise<Tokens> {
  const res = await call('POST', '/api/demo/switch', { token: tokens.accessToken, body: { refreshToken: tokens.refreshToken } })
  expect(res.status).toBe(200)
  return res.json<Tokens>()
}

function weekStart(): string {
  const date = new Date(Date.now() + 9 * 3_600_000)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

async function resetDb() {
  // 同じファイルのテストでDBが共有されるため、行を数えるテストのために全部消す(子→親の順)。
  const tables = [
    'expense_split_comments', 'expense_splits', 'expenses', 'incomes', 'fixed_cost_splits', 'fixed_costs', 'events', 'menu_entries', 'recipes',
    'shopping_list_items', 'inventory_items', 'cards', 'accounts', 'zaiko_categories', 'kakeibo_categories', 'income_categories',
    'household_members', 'households', 'refresh_tokens', 'users', 'demo_households', 'rate_limit_counters',
  ]
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
}

beforeEach(resetDb)
afterEach(() => vi.restoreAllMocks())

describe('GET /api/demo と start', () => {
  it('createDemoHousehold の batch は30文以下に収まる', async () => {
    const batch = vi.spyOn(env.DB, 'batch')
    await createDemoHousehold(env.DB, new Date())
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0].length).toBeLessThanOrEqual(30)
  })

  it('GET /api/demo は DEMO_MODE で enabled: true、なしで enabled: false', async () => {
    expect(await (await call('GET', '/api/demo')).json()).toEqual({ enabled: true })
    const res = await call('GET', '/api/demo', { testEnv: env })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('DEMO_MODE が "true" 以外の値ではデモ環境にならない', async () => {
    expect(await (await call('GET', '/api/demo', { testEnv: { ...env, DEMO_MODE: 'false' } })).json()).toEqual({ enabled: false })
  })

  it('start は DEMO_MODE なしで 404 で、何も作らない', async () => {
    const res = await call('POST', '/api/demo/start', { testEnv: env })
    expect(res.status).toBe(404)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM demo_households').first()).toEqual({ n: 0 })
  })

  it('start で太郎としてログインでき、me の表示名がデモ太郎', async () => {
    const tokens = await start()
    const user = await me(tokens.accessToken)
    expect(user.displayName).toBe('デモ太郎')
    expect(user.demo).toMatchObject({ partnerName: 'デモ花子' })
    const household = await call('GET', '/api/households/me', { token: tokens.accessToken })
    expect(await household.json()).toMatchObject({ name: 'デモ家' })
  })

  it('デモ利用者のメールは予約ドメインで、メールとパスワードではログインできない', async () => {
    await start()
    const rows = await env.DB.prepare('SELECT email FROM users').all<{ email: string }>()
    expect(rows.results).toHaveLength(2)
    expect(rows.results.map((row) => row.email).sort()).toEqual([
      expect.stringMatching(/^demo-[0-9a-f]+-hanako@example\.com$/),
      expect.stringMatching(/^demo-[0-9a-f]+-taro@example\.com$/),
    ])
    const login = await call('POST', '/api/auth/login', { body: { email: rows.results[0].email, password: 'TestPass123!' } })
    expect(login.status).toBe(401)
  })
})

describe('見本データの見え方', () => {
  it('太郎と花子で口座が分かれる', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    expect(names(await list('/api/accounts', taro.accessToken), 'name')).toEqual(['みどり銀行'])
    expect(names(await list('/api/accounts', hanako.accessToken), 'name').sort()).toEqual(['さくら銀行', '交通系IC'].sort())
    const [taroAccount] = await list<{ cards: Array<{ name: string; cardType: string }> }>('/api/accounts', taro.accessToken)
    expect(taroAccount.cards).toMatchObject([{ name: 'いつものクレジット', cardType: 'credit' }])
  })

  it('支出も本人のものだけが見える', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    const taroPurposes = names(await list('/api/expenses', taro.accessToken), 'purpose')
    const hanakoPurposes = names(await list('/api/expenses', hanako.accessToken), 'purpose')
    expect(taroPurposes).toContain('書籍')
    expect(taroPurposes).not.toContain('美容院')
    expect(hanakoPurposes).toContain('美容院')
    expect(hanakoPurposes).not.toContain('書籍')
  })

  it('在庫・レシピ・献立は2人で同じ', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    for (const token of [taro.accessToken, hanako.accessToken]) {
      expect(names(await list('/api/inventory-items', token), 'name')).toEqual(['卵', '牛乳', 'お米', 'トイレットペーパー'])
      const recipes = await list<{ title: string; isFavorite: boolean }>('/api/recipes', token)
      expect(recipes.map((recipe) => recipe.title)).toEqual(['肉じゃが', 'カレーライス', '鮭のホイル焼き'])
      expect(recipes.filter((recipe) => recipe.isFavorite).map((recipe) => recipe.title)).toEqual(['カレーライス'])
      // 買い物リストはしきい値以下の在庫(卵・牛乳・トイレットペーパー)と同じ仕組みで出る。
      expect(names(await list('/api/shopping-list-items', token), 'name').sort()).toEqual(['卵', '牛乳', 'トイレットペーパー'].sort())
      const menu = await list<{ recipeTitle: string | null; freeTextMemo: string | null }>(`/api/menu-entries?weekStartDate=${weekStart()}`, token)
      expect(menu.map((entry) => entry.recipeTitle ?? entry.freeTextMemo)).toEqual(['肉じゃが', '外食'])
    }
  })

  it('割り勘は相手側に負担として出る', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    type Split = { expensePurpose: string; role: string; amountDue: number; status: string }
    const hanakoSplits = await list<Split>('/api/expense-splits', hanako.accessToken)
    expect(hanakoSplits.find((split) => split.expensePurpose === 'スーパー')).toMatchObject({ role: 'debtor', amountDue: 3000, status: 'unpaid' })
    expect(hanakoSplits.find((split) => split.expensePurpose === '日用品')).toMatchObject({ role: 'payer', amountDue: 1200 })
    const taroSplits = await list<Split>('/api/expense-splits', taro.accessToken)
    expect(taroSplits.find((split) => split.expensePurpose === '日用品')).toMatchObject({ role: 'debtor', amountDue: 1200, status: 'unpaid' })
    expect(taroSplits).toHaveLength(2)
  })

  it('個人の予定と固定費は本人だけ', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    expect(names(await list('/api/events', taro.accessToken), 'name').sort()).toEqual(['歯医者', '誕生日会'].sort())
    expect(names(await list('/api/events', hanako.accessToken), 'name').sort()).toEqual(['友人とランチ会', '誕生日会'].sort())
    expect(names(await list('/api/fixed-costs', taro.accessToken), 'name').sort()).toEqual(['スマホ代', '家賃'].sort())
    expect(names(await list('/api/fixed-costs', hanako.accessToken), 'name').sort()).toEqual(['ジム会費', '家賃'].sort())
  })

  it('既定のカテゴリーは各ルートの既定と同じ数で、在庫カテゴリーに日用品が1つ足される', async () => {
    const taro = await start()
    expect(await list('/api/kakeibo-categories', taro.accessToken)).toHaveLength(11)
    expect(await list('/api/income-categories', taro.accessToken)).toHaveLength(5)
    const zaiko = await list<{ name: string; isDefault: boolean }>('/api/zaiko-categories', taro.accessToken)
    expect(zaiko).toHaveLength(11)
    expect(zaiko.filter((category) => category.name === '日用品')).toEqual([expect.objectContaining({ isDefault: false })])
  })

  it('口座残高はアプリで同じ収支を登録したときと同じ', async () => {
    const taro = await start()
    const [account] = await list<{ id: number; balance: number }>('/api/accounts', taro.accessToken)
    expect(account.balance).toBe(519_000)
    const hanako = await switchTo(taro)
    const balances = Object.fromEntries((await list<{ name: string; balance: number }>('/api/accounts', hanako.accessToken)).map((a) => [a.name, a.balance]))
    expect(balances).toEqual({ さくら銀行: 407_200, 交通系IC: 2_200 })

    // 同じ初期残高の口座に、アプリのAPIで同じ収支を登録して残高を比べる(太郎として)。
    const hanakoId = (await me(hanako.accessToken)).id
    const taroAgain = await switchTo(hanako)
    const created = await call('POST', '/api/accounts', { token: taroAgain.accessToken, body: { name: '比較用', type: 'bank', balance: 250_000 } })
    expect(created.status).toBe(201)
    const compareId = (await created.json<{ id: number }>()).id
    const categories = await list<{ id: number; name: string }>('/api/kakeibo-categories', taroAgain.accessToken)
    const incomeCategories = await list<{ id: number; name: string }>('/api/income-categories', taroAgain.accessToken)
    const category = (name: string) => categories.find((c) => c.name === name)!.id
    const income = await call('POST', '/api/incomes', {
      token: taroAgain.accessToken,
      body: { incomeDate: '2026-01-01', amount: 280_000, content: '給与', categoryId: incomeCategories.find((c) => c.name === '給与')!.id, accountId: compareId },
    })
    expect(income.status).toBe(201)
    const spend = (amount: number, purpose: string, categoryName: string, extra: object = {}) =>
      call('POST', '/api/expenses', {
        token: taroAgain.accessToken,
        body: { expenseDate: '2026-01-02', amount, purpose, categoryId: category(categoryName), accountId: compareId, ...extra },
      })
    expect((await spend(1_800, '書籍', '趣味・娯楽')).status).toBe(201)
    expect((await spend(1_200, 'ランチ', '食費')).status).toBe(201)
    expect((await spend(2_000, '映画', '趣味・娯楽')).status).toBe(201)
    expect((await spend(6_000, 'スーパー', '食費', { splitInputType: 'ratio', splits: [{ debtorUserId: hanakoId, ratio: 50 }] })).status).toBe(201)
    const compare = (await list<{ id: number; balance: number }>('/api/accounts', taroAgain.accessToken)).find((a) => a.id === compareId)
    expect(compare!.balance).toBe(account.balance)
  })

  it('固定費の割り勘設定・有効開始日・在庫の自動消費の列は、各ルートが作る行と同じ形', async () => {
    const taro = await start()
    const costs = await list<{ name: string; amount: number; paymentDay: number; personal: boolean; includeInHouseholdTotal: boolean; splits: Array<{ splitRatio: number; amountDue: number }> }>('/api/fixed-costs', taro.accessToken)
    const rent = costs.find((cost) => cost.name === '家賃')!
    expect(rent).toMatchObject({ amount: 120_000, paymentDay: 27, personal: false, includeInHouseholdTotal: true })
    expect(rent.splits).toMatchObject([{ splitRatio: 50, amountDue: 60_000 }])
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
    const rows = await env.DB.prepare('SELECT effective_from AS effectiveFrom FROM fixed_costs').all<{ effectiveFrom: string }>()
    expect(rows.results.map((row) => row.effectiveFrom)).toEqual([today, today, today])
    const items = await env.DB.prepare('SELECT auto_consumption_enabled AS auto, last_consumed_on AS last FROM inventory_items').all<{ auto: number; last: string }>()
    expect(items.results.every((item) => item.auto === 0 && item.last === today)).toBe(true)
  })

  it('日が今日より後になる収入・支出は今日の日付にする', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-02T03:00:00Z') })
    try {
      await createDemoHousehold(env.DB, new Date())
    } finally {
      vi.useRealTimers()
    }
    const dates = await env.DB.prepare('SELECT DISTINCT expense_date AS d FROM expenses ORDER BY d').all<{ d: string }>()
    expect(dates.results.map((row) => row.d)).toEqual(['2026-11-02'])
    const events = await env.DB.prepare("SELECT event_date AS d FROM events WHERE name = '誕生日会'").first<{ d: string }>()
    expect(events!.d).toBe('2026-11-20')
  })
})

describe('start の制限と原子性', () => {
  it('同じ接続元から6回目は 429', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.9' }
    for (let i = 0; i < RATE_LIMITS.demoStartAddress.limit; i += 1) await start(headers)
    const res = await call('POST', '/api/demo/start', { headers })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM demo_households').first()).toEqual({ n: 5 })
    // 別の接続元には影響しない。
    expect((await call('POST', '/api/demo/start', { headers: { 'CF-Connecting-IP': '203.0.113.10' } })).status).toBe(201)
  })

  async function fillDemos(count: number, expiresAt: string) {
    // 件数の確認だけに使う行。世帯・利用者は作らず、demo_households にだけ入れる。
    await env.DB.batch(
      Array.from({ length: count }, (_, i) =>
        env.DB.prepare('INSERT INTO demo_households (household_id, primary_user_id, partner_user_id, expires_at) VALUES (?, ?, ?, ?)')
          .bind(1_000_000 + i, 2_000_000 + i * 2, 2_000_001 + i * 2, expiresAt),
      ),
    )
  }

  it('期限内のデモが300件あると 503 DEMO_CAPACITY_REACHED。何も作らない', async () => {
    await fillDemos(DEMO_MAX_ACTIVE, new Date(Date.now() + 3_600_000).toISOString())
    const res = await call('POST', '/api/demo/start')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'DEMO_CAPACITY_REACHED', message: '混み合っています。時間をおいて試してください' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM demo_households').first()).toEqual({ n: DEMO_MAX_ACTIVE })
  })

  it('299件なら作れる(境界値)。期限切れの行は件数に数えない', async () => {
    await fillDemos(DEMO_MAX_ACTIVE - 1, new Date(Date.now() + 3_600_000).toISOString())
    expect((await call('POST', '/api/demo/start')).status).toBe(201)
    await resetDb()
    await fillDemos(DEMO_MAX_ACTIVE, new Date(Date.now() - 3_600_000).toISOString())
    expect((await call('POST', '/api/demo/start')).status).toBe(201)
  })

  it('途中で失敗したら何も残らない', async () => {
    const count = async () => {
      const results = await env.DB.batch<{ n: number }>(
        ['users', 'households', 'household_members', 'demo_households', 'expenses', 'accounts', 'recipes'].map((table) =>
          env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`),
        ),
      )
      return results.map((result) => result.results[0].n)
    }
    // 同じメールを先に入れておくと、花子の登録で失敗する(太郎の登録・世帯の作成はその前に実行される)。
    await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
      .bind('demo-testconflict-hanako@example.com', 'testuser_unused_hash', 'testuser_conflict')
      .run()
    const before = await count()
    await expect(createDemoHousehold(env.DB, new Date(), { token: 'testconflict' })).rejects.toThrow()
    expect(await count()).toEqual(before)
  })
})

describe('POST /api/demo/switch', () => {
  it('太郎→花子→太郎と切り替わる', async () => {
    const taro = await start()
    const hanako = await switchTo(taro)
    expect(await me(hanako.accessToken)).toMatchObject({ displayName: 'デモ花子', demo: { partnerName: 'デモ太郎' } })
    const taroAgain = await switchTo(hanako)
    expect(await me(taroAgain.accessToken)).toMatchObject({ displayName: 'デモ太郎' })
  })

  it('切り替え前のリフレッシュトークンは失効し、refresh が 401', async () => {
    const taro = await start()
    expect((await call('POST', '/api/auth/refresh', { body: { refreshToken: taro.refreshToken } })).status).toBe(200)
    await switchTo(taro)
    expect((await call('POST', '/api/auth/refresh', { body: { refreshToken: taro.refreshToken } })).status).toBe(401)
  })

  it('本文の refreshToken が本人のものでなければ 404 で、何も失効しない', async () => {
    const a = await start()
    const b = await start()
    const res = await call('POST', '/api/demo/switch', { token: a.accessToken, body: { refreshToken: b.refreshToken } })
    expect(res.status).toBe(404)
    expect((await call('POST', '/api/auth/refresh', { body: { refreshToken: b.refreshToken } })).status).toBe(200)
    expect((await call('POST', '/api/auth/refresh', { body: { refreshToken: a.refreshToken } })).status).toBe(200)
    const unknown = await call('POST', '/api/demo/switch', { token: a.accessToken, body: { refreshToken: 'testtoken_unknown' } })
    expect(unknown.status).toBe(404)
  })

  it('本文が不正なら 400', async () => {
    const a = await start()
    expect((await call('POST', '/api/demo/switch', { token: a.accessToken, body: {} })).status).toBe(400)
  })

  it('デモでない利用者は 404（相手のトークンは出ない）', async () => {
    const user = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
      .bind('testuser_normal@example.com', 'testuser_unused_hash', 'testuser_normal')
      .first<{ id: number }>()
    const token = await signAccessToken(user!.id, env.JWT_SECRET, 900)
    const res = await call('POST', '/api/demo/switch', { token, body: { refreshToken: 'testtoken_unused' } })
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('accessToken')
  })

  it('DEMO_MODE なしでは 404（認証より前に判定し、失効もしない）', async () => {
    const taro = await start()
    const res = await call('POST', '/api/demo/switch', { token: taro.accessToken, body: { refreshToken: taro.refreshToken }, testEnv: env })
    expect(res.status).toBe(404)
    expect((await call('POST', '/api/auth/refresh', { body: { refreshToken: taro.refreshToken } })).status).toBe(200)
    expect((await call('POST', '/api/demo/switch', { testEnv: env })).status).toBe(404)
  })

  it('期限切れのデモ利用者は 401', async () => {
    const taro = await start()
    await env.DB.prepare('UPDATE demo_households SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run()
    const res = await call('POST', '/api/demo/switch', { token: taro.accessToken, body: { refreshToken: taro.refreshToken } })
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('refreshToken')
  })
})

describe('GET /api/auth/me の demo', () => {
  it('デモ利用者は { expiresAt, partnerName }。通常の利用者と DEMO_MODE なしでは null', async () => {
    const taro = await start()
    const user = await me(taro.accessToken)
    const expiresAt = (await env.DB.prepare('SELECT expires_at AS e FROM demo_households').first<{ e: string }>())!.e
    expect(user.demo).toEqual({ expiresAt, partnerName: 'デモ花子' })
    const hanako = await switchTo(taro)
    expect((await me(hanako.accessToken)).demo).toEqual({ expiresAt, partnerName: 'デモ太郎' })

    const res = await call('GET', '/api/auth/me', { token: hanako.accessToken, testEnv: env })
    expect(await res.json()).toMatchObject({ demo: null })

    const normal = await env.DB.prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id')
      .bind('testuser_normal2@example.com', 'testuser_unused_hash', 'testuser_normal2')
      .first<{ id: number }>()
    expect((await me(await signAccessToken(normal!.id, env.JWT_SECRET, 900))).demo).toBeNull()
  })
})
