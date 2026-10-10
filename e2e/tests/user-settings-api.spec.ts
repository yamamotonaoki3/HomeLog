import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

const DEFAULT_ORDER = ['today', 'stock', 'finance', 'money', 'eventExpenses']

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

function toNewFormat(settings: Settings): Settings {
  return {
    cards: settings.cards,
    cardOrder: settings.cardOrder,
    items: {
      today: settings.items.today,
      stock: { shoppingList: settings.items.stock.shoppingList, inventoryList: settings.items.stock.inventoryList },
      money: { personal: settings.items.money.personal, householdTotal: settings.items.money.householdTotal, unsettled: settings.items.money.unsettled },
      calendar: { income: settings.items.calendar.income, expense: settings.items.calendar.expense, events: settings.items.calendar.events },
    },
  }
}

async function accessTokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  expect(token).toBeTruthy()
  return token!
}

function settingsApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` }
  return {
    get: () => request.get('/api/user-settings', { headers }),
    put: (data: unknown) => request.put('/api/user-settings', { headers, data }),
  }
}

test.describe('S-21 ダッシュボード表示設定API', () => {
  test('再設計後の既定値を返し、表示OFFとカード順を保存・再取得できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'settings_api')
    const api = settingsApi(page.request, await accessTokenOf(page))

    const initial = await api.get()
    expect(initial.ok()).toBeTruthy()
    const defaults = toNewFormat(await initial.json())
    expect(defaults.cardOrder).toEqual(DEFAULT_ORDER)
    expect(defaults.cards).toEqual({ today: true, stock: true, finance: true, money: true, eventExpenses: true, calendar: true })
    expect(defaults.items.stock).toEqual({ shoppingList: true, inventoryList: true })
    expect(defaults.items.calendar).toEqual({ income: true, expense: true, events: true })

    const updated = {
      ...defaults,
      cards: { ...defaults.cards, finance: false },
      cardOrder: ['eventExpenses', 'money', 'finance', 'stock', 'today'],
      items: { ...defaults.items, calendar: { income: true, expense: false, events: true } },
    }
    const saved = await api.put(updated)
    expect(saved.status()).toBe(200)
    expect(toNewFormat(await saved.json())).toEqual(updated)
    expect(toNewFormat(await (await api.get()).json())).toEqual(updated)
  })

  test('不正なカード順は400で拒否し、保存済みの設定を維持する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'settings_api_invalid')
    const api = settingsApi(page.request, await accessTokenOf(page))
    const defaults = await (await api.get()).json()

    const rejected = await api.put({ ...defaults, cardOrder: ['today', 'today', 'stock', 'finance', 'money'] })
    expect(rejected.status()).toBe(400)
    expect((await api.get()).ok()).toBeTruthy()
    expect(await (await api.get()).json()).toEqual(defaults)
  })
})
