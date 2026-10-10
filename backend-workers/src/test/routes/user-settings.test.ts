import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

type Settings = {
  cards: Record<'today' | 'stock' | 'finance' | 'money' | 'eventExpenses' | 'calendar', boolean>
  cardOrder: string[]
  items: {
    today: Record<'balance' | 'menu' | 'events', boolean>
    stock: Record<'shoppingList' | 'inventoryList', boolean>
    money: Record<'personal' | 'householdTotal' | 'unsettled', boolean>
    calendar: Record<'income' | 'expense' | 'events', boolean>
  }
}

const DEFAULT_ORDER = ['today', 'stock', 'finance', 'money', 'eventExpenses']

function fullSettings(): Settings {
  return {
    cards: { today: true, stock: true, finance: true, money: true, eventExpenses: true, calendar: true },
    cardOrder: [...DEFAULT_ORDER],
    items: {
      today: { balance: true, menu: true, events: true },
      stock: { shoppingList: true, inventoryList: true },
      money: { personal: true, householdTotal: true, unsettled: true },
      calendar: { income: true, expense: true, events: true },
    },
  }
}

function responseSettings(settings: Settings = fullSettings()) {
  return {
    ...settings,
    items: {
      ...settings.items,
      stock: { ...settings.items.stock, shoppingCount: settings.items.stock.shoppingList, lowStock: settings.items.stock.inventoryList, commonItems: false },
      money: { ...settings.items.money, eventSummary: settings.cards.eventExpenses },
      calendar: { ...settings.items.calendar, balance: settings.items.calendar.income || settings.items.calendar.expense },
    },
  }
}

type ResponseSettings = ReturnType<typeof responseSettings>

function withoutAliases(settings: ResponseSettings): Settings {
  return {
    ...settings,
    items: {
      today: settings.items.today,
      stock: { shoppingList: settings.items.stock.shoppingList, inventoryList: settings.items.stock.inventoryList },
      money: { personal: settings.items.money.personal, householdTotal: settings.items.money.householdTotal, unsettled: settings.items.money.unsettled },
      calendar: { income: settings.items.calendar.income, expense: settings.items.calendar.expense, events: settings.items.calendar.events },
    },
  }
}

function settingsWithoutOrder(): Omit<Settings, 'cardOrder'> {
  const settings: Partial<Settings> = fullSettings()
  delete settings.cardOrder
  return settings as Omit<Settings, 'cardOrder'>
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_settings'), env.DB.prepare('DELETE FROM users')])
})

let seq = 0
async function createUser() {
  seq += 1
  const user = await env.DB.prepare('INSERT INTO users (email,password_hash,display_name) VALUES (?,?,?) RETURNING id')
    .bind(`settings_${seq}@example.com`, 'hash', `testuser_${seq}`)
    .first<{ id: number }>()
  return { id: user!.id, auth: { Authorization: `Bearer ${await signAccessToken(user!.id, env.JWT_SECRET, 900)}` } }
}

function get(auth: Record<string, string>) {
  return app.request('/api/user-settings', { headers: auth }, env)
}

function put(auth: Record<string, string>, body: unknown) {
  return app.request(
    '/api/user-settings',
    { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) },
    env,
  )
}

async function storeRaw(userId: number, raw: unknown) {
  await env.DB.prepare('INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, ?)').bind(userId, JSON.stringify(raw)).run()
}

const legacySettings = {
  cards: { today: true, money: false, finance: true, stock: true, calendar: true },
  items: {
    today: { balance: true, menu: false, events: true },
    money: { personal: true, householdTotal: false, unsettled: true, eventSummary: true },
    stock: { shoppingCount: false, lowStock: true, commonItems: true },
    calendar: { events: false, balance: true },
  },
}

describe('GET /api/user-settings', () => {
  it('未登録ユーザーには再設計後の全項目trueと標準カード順を返す', async () => {
    const { auth } = await createUser()
    const res = await get(auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings())
  })

  it('旧形式の保存値を新形式へ移行して返し、commonItemsはfalseで返す', async () => {
    const { id, auth } = await createUser()
    await storeRaw(id, legacySettings)
    const body = await (await get(auth)).json<ResponseSettings>()
    expect(body.cards).toEqual({ today: true, stock: true, finance: true, money: false, eventExpenses: false, calendar: true })
    expect(body.cardOrder).toEqual(DEFAULT_ORDER)
    expect(body.items.today).toEqual({ balance: true, menu: false, events: true })
    expect(body.items.stock).toEqual({ shoppingList: false, inventoryList: true, shoppingCount: false, lowStock: true, commonItems: false })
    expect(body.items.money).toEqual({ personal: true, householdTotal: false, unsettled: true, eventSummary: false })
    expect(body.items.calendar).toEqual({ income: true, expense: true, events: false, balance: true })
    expect(body.items.stock.commonItems).toBe(false)
  })

  it.each([[false, false], [true, false], [false, true]])('互換エイリアスは新キーの値と一致する（income=%s, expense=%s）', async (income, expense) => {
    const { id, auth } = await createUser()
    const settings = fullSettings()
    settings.items.stock.shoppingList = false
    settings.items.stock.inventoryList = false
    settings.cards.eventExpenses = false
    settings.items.calendar.income = income
    settings.items.calendar.expense = expense
    await storeRaw(id, settings)
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it('カード順を持たない新形式の保存値には標準カード順を補完する', async () => {
    const { id, auth } = await createUser()
    const withoutOrder = settingsWithoutOrder()
    await storeRaw(id, { ...withoutOrder, cards: { ...withoutOrder.cards, stock: false } })
    const body = await (await get(auth)).json<ResponseSettings>()
    expect(body.cardOrder).toEqual(DEFAULT_ORDER)
    expect(body.cards.stock).toBe(false)
  })

  it('保存値が壊れている場合は既定値を返す', async () => {
    const { id, auth } = await createUser()
    await env.DB.prepare('INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, ?)').bind(id, '{not json').run()
    const res = await get(auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings())
  })

  it('未認証は401', async () => {
    expect((await app.request('/api/user-settings', {}, env)).status).toBe(401)
  })
})

describe('migration 0013_dashboard_settings_redesign', () => {
  async function runMigration() {
    const migrations = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS
    const target = migrations.find((m) => m.name.startsWith('0013_'))
    expect(target).toBeDefined()
    for (const query of target!.queries) await env.DB.prepare(query).run()
  }

  async function stored(userId: number) {
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(userId).first<{ s: string }>()
    return row!.s
  }

  it('旧形式の行を新形式へ書き換え、APIの移行結果と一致させる', async () => {
    const { id, auth } = await createUser()
    await storeRaw(id, legacySettings)
    const apiResult = withoutAliases(await (await get(auth)).json<ResponseSettings>())
    await runMigration()
    const raw = await stored(id)
    expect(raw).not.toContain('commonItems')
    expect(JSON.parse(raw)).toEqual(apiResult)
  })

  it('新形式の行・壊れた行は変更しない', async () => {
    const modern = await createUser()
    const broken = await createUser()
    const settings = { ...fullSettings(), cardOrder: ['money', 'today', 'stock', 'finance', 'eventExpenses'] }
    await storeRaw(modern.id, settings)
    await env.DB.prepare('INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, ?)').bind(broken.id, '{not json').run()
    await runMigration()
    expect(JSON.parse(await stored(modern.id))).toEqual(settings)
    expect(await stored(broken.id)).toBe('{not json')
  })
})

describe('PUT /api/user-settings', () => {
  it('表示OFFのカードを含む設定と並べ替えたカード順を保存・再取得できる', async () => {
    const { auth } = await createUser()
    const settings = fullSettings()
    settings.cards.finance = false
    settings.cards.calendar = false
    settings.items.calendar.expense = false
    settings.cardOrder = ['eventExpenses', 'money', 'finance', 'stock', 'today']
    const res = await put(auth, settings)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it('不足しているカードは標準順で末尾へ補完して保存する', async () => {
    const { auth } = await createUser()
    const res = await put(auth, { ...fullSettings(), cardOrder: ['money', 'today'] })
    expect(res.status).toBe(200)
    expect((await res.json<Settings>()).cardOrder).toEqual(['money', 'today', 'stock', 'finance', 'eventExpenses'])
  })

  it('カード順が省略された場合は標準順で保存する', async () => {
    const { auth } = await createUser()
    const withoutOrder = settingsWithoutOrder()
    const res = await put(auth, withoutOrder)
    expect(res.status).toBe(200)
    expect((await res.json<Settings>()).cardOrder).toEqual(DEFAULT_ORDER)
  })

  it.each([
    ['重複したカード', ['today', 'today', 'stock', 'finance', 'money']],
    ['未知のカード', ['today', 'stock', 'finance', 'money', 'unknown']],
    ['順序対象外のカレンダー', ['calendar', 'today', 'stock', 'finance', 'money', 'eventExpenses']],
    ['配列以外', 'today'],
  ])('%sを含むカード順は400で拒否し、既存の設定を壊さない', async (_label, cardOrder) => {
    const { auth } = await createUser()
    const saved = { ...fullSettings(), cardOrder: ['money', 'today', 'stock', 'finance', 'eventExpenses'] }
    expect((await put(auth, saved)).status).toBe(200)
    expect((await put(auth, { ...fullSettings(), cardOrder })).status).toBe(400)
    expect(await (await get(auth)).json()).toEqual(responseSettings(saved))
  })

  it('GETレスポンスのカード順を重複させた送信は400で拒否し、保存済みの設定を維持する', async () => {
    const { id, auth } = await createUser()
    const saved = { ...fullSettings(), cardOrder: ['money', 'today', 'stock', 'finance', 'eventExpenses'] }
    await storeRaw(id, saved)
    const body = await (await get(auth)).json<ResponseSettings>()
    body.cardOrder = ['today', 'today', 'stock', 'finance', 'money']
    expect((await put(auth, body)).status).toBe(400)
    expect(await (await get(auth)).json()).toEqual(responseSettings(saved))
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(id).first<{ s: string }>()
    expect(JSON.parse(row!.s)).toEqual(saved)
  })

  it('eventExpensesを含む本文で他の新キーが欠けている場合は400で拒否し、保存済みの設定を維持する', async () => {
    const { id, auth } = await createUser()
    const saved = fullSettings()
    await storeRaw(id, saved)
    const body = { ...legacySettings, cards: { ...legacySettings.cards, eventExpenses: true } }
    expect((await put(auth, body)).status).toBe(400)
    expect(await (await get(auth)).json()).toEqual(responseSettings(saved))
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(id).first<{ s: string }>()
    expect(JSON.parse(row!.s)).toEqual(saved)
  })

  it.each([
    ['空オブジェクト', {}],
    ['JSONでない本文', '{broken'],
    ['真偽値でないカード', { ...fullSettings(), cards: { ...fullSettings().cards, today: 'yes' } }],
    ['項目の欠落', { ...fullSettings(), items: { ...fullSettings().items, stock: { shoppingList: true } } }],
  ])('%sは400', async (_label, body) => {
    const { auth } = await createUser()
    expect((await put(auth, body)).status).toBe(400)
  })

  it('旧形式の送信は新形式へ移行して保存し、commonItemsは保存しない', async () => {
    const { id, auth } = await createUser()
    const res = await put(auth, legacySettings)
    expect(res.status).toBe(200)
    const body = await res.json<Settings>()
    expect(body.items.stock).toEqual({ shoppingList: false, inventoryList: true, shoppingCount: false, lowStock: true, commonItems: false })
    expect(body.cardOrder).toEqual(DEFAULT_ORDER)
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(id).first<{ s: string }>()
    expect(row!.s).not.toContain('commonItems')
  })

  it('新形式に旧項目が混在していても無視して保存する', async () => {
    const { auth } = await createUser()
    const mixed = fullSettings() as Settings & { items: { stock: Record<string, boolean> } }
    mixed.items.stock.commonItems = true
    const res = await put(auth, mixed)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings())
  })

  it('新形式と混在する旧キーの変更を優先し、新形式のみ保存する', async () => {
    const { id, auth } = await createUser()
    const mixed = await (await get(auth)).json<ResponseSettings>()
    mixed.items.stock.shoppingCount = false
    mixed.items.stock.lowStock = false
    mixed.items.stock.commonItems = true
    mixed.items.money.eventSummary = false
    mixed.items.calendar.balance = false
    const expected = fullSettings()
    expected.items.stock.shoppingList = false
    expected.items.stock.inventoryList = false
    expected.cards.eventExpenses = false
    expected.items.calendar.income = false
    expected.items.calendar.expense = false
    const res = await put(auth, mixed)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(expected))
    expect(await (await get(auth)).json()).toEqual(responseSettings(expected))
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(id).first<{ s: string }>()
    expect(JSON.parse(row!.s)).toEqual(expected)
  })

  it('GETレスポンスのエイリアスを残して買い物・在庫の新キーをfalseに変更すると保存される', async () => {
    const { id, auth } = await createUser()
    await storeRaw(id, fullSettings())
    const body = await (await get(auth)).json<ResponseSettings>()
    body.items.stock.shoppingList = false
    body.items.stock.inventoryList = false
    const settings = withoutAliases(body)
    const res = await put(auth, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it('GETレスポンスのエイリアスを残してeventExpensesをfalseに変更すると保存される', async () => {
    const { id, auth } = await createUser()
    await storeRaw(id, fullSettings())
    const body = await (await get(auth)).json<ResponseSettings>()
    body.cards.eventExpenses = false
    const settings = withoutAliases(body)
    const res = await put(auth, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it('GETレスポンスのエイリアスを残してカレンダーの収入・支出をfalseに変更すると保存される', async () => {
    const { id, auth } = await createUser()
    await storeRaw(id, fullSettings())
    const body = await (await get(auth)).json<ResponseSettings>()
    body.items.calendar.income = false
    body.items.calendar.expense = false
    const settings = withoutAliases(body)
    const res = await put(auth, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it.each([[true, false], [false, true]])('GETレスポンスで別カードだけ変更してもカレンダーの非対称設定を維持する（income=%s, expense=%s）', async (income, expense) => {
    const { auth } = await createUser()
    const settings = fullSettings()
    settings.items.calendar.income = income
    settings.items.calendar.expense = expense
    expect((await put(auth, settings)).status).toBe(200)
    const body = await (await get(auth)).json<ResponseSettings>()
    body.cards.finance = false
    settings.cards.finance = false
    const res = await put(auth, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it.each([[true, false], [false, true]])('非対称設定のGETレスポンスでbalanceをfalseに変更すると収入・支出ともfalseで保存する（income=%s, expense=%s）', async (income, expense) => {
    const { auth } = await createUser()
    const settings = fullSettings()
    settings.items.calendar.income = income
    settings.items.calendar.expense = expense
    expect((await put(auth, settings)).status).toBe(200)
    const body = await (await get(auth)).json<ResponseSettings>()
    body.items.calendar.balance = false
    settings.items.calendar.income = false
    settings.items.calendar.expense = false
    const res = await put(auth, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(responseSettings(settings))
    expect(await (await get(auth)).json()).toEqual(responseSettings(settings))
  })

  it.each(['shoppingCount', 'lowStock', 'eventSummary', 'balance'] as const)('旧エイリアス%sが真偽値以外なら400', async (key) => {
    const { id, auth } = await createUser()
    const settings = fullSettings()
    await storeRaw(id, settings)
    const section = key === 'eventSummary' ? 'money' : key === 'balance' ? 'calendar' : 'stock'
    for (const value of ['false', 0, null, {}, []]) {
      const body = { ...settings, items: { ...settings.items, [section]: { ...settings.items[section], [key]: value } } }
      expect((await put(auth, body)).status).toBe(400)
    }
    const row = await env.DB.prepare('SELECT dashboard_settings AS s FROM user_settings WHERE user_id = ?').bind(id).first<{ s: string }>()
    expect(JSON.parse(row!.s)).toEqual(settings)
  })

  it('設定はユーザー本人だけに保存され、他のユーザーへ影響しない', async () => {
    const owner = await createUser()
    const other = await createUser()
    const settings = { ...fullSettings(), cardOrder: ['eventExpenses', 'today', 'stock', 'finance', 'money'] }
    settings.cards.today = false
    expect((await put(owner.auth, settings)).status).toBe(200)
    expect(await (await get(other.auth)).json()).toEqual(responseSettings())
    expect(await (await get(owner.auth)).json()).toEqual(responseSettings(settings))
  })

  it('未認証は401', async () => {
    const res = await app.request('/api/user-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fullSettings()) }, env)
    expect(res.status).toBe(401)
  })
})
