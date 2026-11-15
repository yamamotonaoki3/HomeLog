import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// #548 Web E2Eの準備・結果確認用。実際に検証するmutationは画面から操作する。
export interface LinkedStock {
  id: number; name: string; quantity: number; menuPlanEnabled: boolean; menuPlanRevision: number
  menuLinks: { id: number; recipeId: number | null; recipeTitle: string; usageQuantity: number; enabled: boolean; carryEnabled: boolean; revision: number; remainingCount: number | null; memo: string | null }[]
}
export interface LinkedMeal {
  id: number; recipeId: number | null; recipeTitle: string | null
  inventoryLinkage: null | {
    linkId: number | null; inventoryItemId: number | null; inventoryName: string | null; quantity: number | null; usageQuantity: number
    enabled: boolean; carryEnabled: boolean; linkRevision: number | null; remainingCount: number | null; memo: string | null; undoQuantity: number | null
    mealState: 'uneaten' | 'eaten'; mealRevision: number; canConsume: boolean; canUndo: boolean
  }
}

export function currentJstWeek(): string {
  const now = new Date(Date.now() + 9 * 3_600_000)
  now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  return now.toISOString().slice(0, 10)
}

export async function menuHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  if (!token) throw new Error('Web E2Eのログイン状態がありません')
  return { Authorization: `Bearer ${token}` }
}

export async function readStocks(page: Page): Promise<LinkedStock[]> {
  const response = await page.request.get('/api/inventory-items', { headers: await menuHeaders(page) })
  expect(response.status()).toBe(200)
  return response.json()
}

export async function readMeals(page: Page): Promise<LinkedMeal[]> {
  const response = await page.request.get(`/api/menu-entries?weekStartDate=${currentJstWeek()}`, { headers: await menuHeaders(page) })
  expect(response.status()).toBe(200)
  return response.json()
}

export async function seedOriginal(page: Page, title: string): Promise<number> {
  const response = await page.request.post('/api/recipes', { headers: await menuHeaders(page), data: { title } })
  expect(response.status()).toBe(201)
  return (await response.json()).id
}

export async function seedLinkedStock(page: Page, name: string, quantity = 3, recipeId?: number): Promise<LinkedStock> {
  const headers = await menuHeaders(page)
  const categories = await page.request.get('/api/zaiko-categories', { headers })
  expect(categories.status()).toBe(200)
  const response = await page.request.post('/api/inventory-items', { headers, data: {
    name, categoryId: (await categories.json())[0].id, storeId: null, quantity, threshold: 0,
    menuLinkage: { requestId: randomUUID(), menus: [{ ...(recipeId === undefined ? { newRecipeTitle: name + 'の料理' } : { recipeId }), usageQuantity: 1, carryEnabled: quantity > 0 }] },
  } })
  expect(response.status()).toBe(201)
  const created = await response.json()
  const stock = (await readStocks(page)).find(row => row.id === created.id)
  if (!stock) throw new Error('準備した連携在庫が取得できません')
  return stock
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

/** #555 planned setup only; mutations under test are performed through the UI. */
export async function seedPlannedStock(page: Page, name: string, quantity = 3, recipeId?: number, remainingCount = quantity): Promise<LinkedStock> {
  const headers = await menuHeaders(page)
  const categories = await page.request.get('/api/zaiko-categories', { headers })
  expect(categories.status()).toBe(200)
  const response = await page.request.post('/api/inventory-items', { headers, data: {
    name, categoryId: (await categories.json())[0].id, storeId: null, quantity, threshold: 0,
    menuPlan: { requestId: randomUUID(), enabled: true, links: [{ ...(recipeId === undefined ? { newRecipeTitle: name + 'の料理' } : { recipeId }), remainingCount, memo: null, carryEnabled: false }] },
  } })
  expect(response.status()).toBe(201)
  const created = await response.json()
  const stock = (await readStocks(page)).find(row => row.id === created.id)
  if (!stock) throw new Error('準備した予定在庫が取得できません')
  return stock
}
