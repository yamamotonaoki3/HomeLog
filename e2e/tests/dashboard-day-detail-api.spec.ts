import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

const origin = process.env.E2E_WORKERS_API_ORIGIN ?? 'http://127.0.0.1:8787'
const apiOrigin = new URL(origin)
if (apiOrigin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(apiOrigin.hostname)) {
  throw new Error('API E2Eの接続先は専用のローカルWorkersに限定してください')
}
type Headers = { Authorization: string }

async function user(request: APIRequestContext, label: string) {
  const data = newUser(label)
  expect((await request.post(origin + '/api/auth/register', { data })).status()).toBe(201)
  const login = await request.post(origin + '/api/auth/login', { data: { email: data.email, password: data.password } })
  expect(login.status()).toBe(200)
  return { Authorization: 'Bearer ' + (await login.json()).accessToken }
}
async function post(request: APIRequestContext, headers: Headers, path: string, data: unknown) {
  const response = await request.post(origin + '/api/' + path, { headers, data })
  expect(response.status()).toBe(201)
  return response.json()
}
async function get(request: APIRequestContext, headers: Headers, path: string) {
  const response = await request.get(origin + '/api/' + path, { headers })
  expect(response.status()).toBe(200)
  return response.json()
}
function monday(date: string) {
  const day = new Date(date + 'T00:00:00Z')
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}
function futureDate() {
  const now = new Date(Date.now() + 9 * 3600000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15)).toISOString().slice(0, 10)
}

test('日付詳細APIは認証・世帯・実在日付を検証し、空日も完全DTOを返す (#446)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const date = '2031-01-01'
  expect((await request.get(origin + '/api/dashboard/day-detail?date=' + date)).status()).toBe(401)
  const headers = await user(request, 'day_detail_empty')
  const noHousehold = await request.get(origin + '/api/dashboard/day-detail?date=' + date, { headers })
  expect(noHousehold.status()).toBe(404)
  expect(await noHousehold.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  await post(request, headers, 'households', { name: '[E2E_TEST] 日付詳細の空世帯' })
  for (const query of ['', '?date=2031-02-29', '?date=2031-13-01', '?date=2031-1-1', '?date=invalid']) {
    const response = await request.get(origin + '/api/dashboard/day-detail' + query, { headers })
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  }
  expect(await get(request, headers, 'dashboard/day-detail?date=' + date)).toEqual({
    date, weekStartDate: '2030-12-30', menuEntries: [], events: [],
    finance: { income: 0, expense: 0, balance: 0, incomes: [], expenses: [] }, fixedCosts: [],
  })
})

test('日付詳細APIは本人実績・選択週・繰返し・予定固定費を返し、GETで記録を更新しない (#446)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const headers = await user(request, 'day_detail_records')
  await post(request, headers, 'households', { name: '[E2E_TEST] 日付詳細の本人実績' })
  const date = futureDate()
  const weekStartDate = monday(date)
  const account = await post(request, headers, 'accounts', { name: '[E2E_TEST] 本人口座', type: 'bank', balance: 10000 })
  const incomes = await get(request, headers, 'income-categories')
  const expenses = await get(request, headers, 'kakeibo-categories')
  const income = await post(request, headers, 'incomes', { incomeDate: date, amount: 5000, content: '[E2E_TEST] 本人収入', categoryId: incomes[0].id, accountId: account.id })
  const expense = await post(request, headers, 'expenses', { expenseDate: date, amount: 2000, purpose: '[E2E_TEST] 本人支出', categoryId: expenses[0].id, accountId: account.id })
  const fixed = await post(request, headers, 'fixed-costs', { name: '[E2E_TEST] 予定固定費', amount: 80000, paymentDay: 15, personal: true, accountId: account.id })
  const event = await post(request, headers, 'events', { name: '[E2E_TEST] 毎日イベント', eventDate: '2020-01-01', recurrenceType: 'daily', personal: false })
  const recipe = await post(request, headers, 'recipes', { title: '[E2E_TEST] 選択週レシピ', sourceType: 'manual' })
  const entry = await post(request, headers, 'menu-entries', { recipeId: recipe.id, weekStartDate })
  const memo = await post(request, headers, 'menu-entries', { freeTextMemo: '[E2E_TEST] 選択週メモ', weekStartDate })
  const deletedRecipe = await post(request, headers, 'recipes', { title: '[E2E_TEST] 削除原本', sourceType: 'manual' })
  const deletedEntry = await post(request, headers, 'menu-entries', { recipeId: deletedRecipe.id, weekStartDate })
  expect((await request.delete(origin + '/api/recipes/' + deletedRecipe.id, { headers })).status()).toBe(204)
  const nextWeek = new Date(weekStartDate + 'T00:00:00Z')
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7)
  await post(request, headers, 'menu-entries', { freeTextMemo: '[E2E_TEST] 別週', weekStartDate: nextWeek.toISOString().slice(0, 10) })
  const snapshot = async () => {
    const result: Record<string, unknown> = {}
    for (const path of ['incomes', 'expenses', 'accounts', 'fixed-costs', 'events', 'income-categories', 'kakeibo-categories', 'menu-entries?weekStartDate=' + weekStartDate]) result[path] = await get(request, headers, path)
    return result
  }
  const before = await snapshot()
  const detail = await get(request, headers, 'dashboard/day-detail?date=' + date)
  expect(detail).toEqual({
    date, weekStartDate,
    menuEntries: [
      { id: entry.id, recipeId: recipe.id, recipeTitle: recipe.title, freeTextMemo: null, weekStartDate },
      { id: memo.id, recipeId: null, recipeTitle: null, freeTextMemo: '[E2E_TEST] 選択週メモ', weekStartDate },
      { id: deletedEntry.id, recipeId: null, recipeTitle: null, freeTextMemo: null, weekStartDate },
    ],
    events: [{ id: event.id, name: event.name, isRecurring: true, recurrenceType: 'daily', eventDate: '2020-01-01' }],
    finance: {
      income: 5000, expense: 2000, balance: 3000,
      incomes: [{ id: income.id, incomeDate: date, amount: 5000, content: '[E2E_TEST] 本人収入' }],
      expenses: [{ id: expense.id, expenseDate: date, amount: 2000, purpose: '[E2E_TEST] 本人支出', fixedCostId: null, fixedCostYearMonth: null }],
    },
    fixedCosts: [{ id: fixed.id, name: fixed.name, amount: 80000, paymentDate: date, yearMonth: date.slice(0, 7), postingStatus: 'scheduled', postedExpense: null }],
  })
  expect(await get(request, headers, 'dashboard/day-detail?date=' + date)).toEqual(detail)
  expect(await snapshot()).toEqual(before)
})

test('日付詳細APIは同世帯他人の私的記録と別世帯を秘匿し、共有他者の計上をunknownにする (#446)', async ({ request, page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await user(request, 'day_detail_owner')
  const household = await post(request, a, 'households', { name: '[E2E_TEST] 日付詳細の認可世帯' })
  const b = await user(request, 'day_detail_member')
  expect((await request.post(origin + '/api/households/join', { headers: b, data: { inviteCode: household.inviteCode } })).status()).toBe(200)
  const c = await user(request, 'day_detail_other_household')
  await post(request, c, 'households', { name: '[E2E_TEST] 別世帯' })
  const date = futureDate()
  const shared = await post(request, b, 'fixed-costs', { name: '[E2E_TEST] 他者共有固定費', amount: 98765, paymentDay: 15, personal: false })
  await post(request, b, 'fixed-costs', { name: '[E2E_TEST] 他者非公開固定費', amount: 65432, paymentDay: 15, personal: true })
  const sharedEvent = await post(request, b, 'events', { name: '[E2E_TEST] 他者共有イベント', eventDate: date, personal: false })
  await post(request, b, 'events', { name: '[E2E_TEST] 他者非公開イベント', eventDate: date, personal: true })
  const category = await get(request, b, 'kakeibo-categories')
  await post(request, b, 'expenses', { expenseDate: date, amount: 8765, purpose: '[E2E_TEST] 他者支出', categoryId: category[0].id })
  const account = await post(request, b, 'accounts', { name: '[E2E_TEST] 他者口座', type: 'bank', balance: 0 })
  const incomeCategories = await get(request, b, 'income-categories')
  await post(request, b, 'incomes', { incomeDate: date, amount: 7654, content: '[E2E_TEST] 他者収入', categoryId: incomeCategories[0].id, accountId: account.id })
  await post(request, c, 'events', { name: '[E2E_TEST] 別世帯共有イベント', eventDate: date, personal: false })
  await post(request, c, 'fixed-costs', { name: '[E2E_TEST] 別世帯共有固定費', amount: 54321, paymentDay: 15, personal: false })
  const privateBefore = await Promise.all(['expenses', 'incomes', 'accounts', 'fixed-costs'].map(path => get(request, b, path)))
  const detail = await get(request, a, 'dashboard/day-detail?date=' + date)
  expect(detail.finance).toEqual({ income: 0, expense: 0, balance: 0, incomes: [], expenses: [] })
  expect(detail.events).toEqual([{ id: sharedEvent.id, name: sharedEvent.name, isRecurring: false, recurrenceType: 'none', eventDate: date }])
  expect(detail.fixedCosts).toEqual([{ id: shared.id, name: shared.name, amount: 98765, paymentDate: date, yearMonth: date.slice(0, 7), postingStatus: 'unknown', postedExpense: null }])
  expect(await get(request, a, 'dashboard/day-detail?date=' + date)).toEqual(detail)
  expect(await Promise.all(['expenses', 'incomes', 'accounts', 'fixed-costs'].map(path => get(request, b, path)))).toEqual(privateBefore)
})
