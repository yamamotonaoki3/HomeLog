import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { APIRequestContext, Browser, Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { register, createHousehold } from './support/flows'
import { E2E_PASSWORD } from './support/test-data'

// README の GIF 用に、画面操作を動画で録画する(#306)。README_GIF_DIR を指定したときだけ動く。
// データはすべてローカルの E2E 用 D1 に入れる架空のデモデータで、E2E 実行後の後始末で削除される。
const OUT = process.env.README_GIF_DIR
const VIEWPORT = { width: 390, height: 844 }

test.describe.configure({ mode: 'serial' })
test.skip(!OUT, 'README_GIF_DIR を指定したときだけ録画する')

function jstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function dayOfThisMonth(day: number) {
  return `${jstToday().slice(0, 8)}${String(day).padStart(2, '0')}`
}

async function seed(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` }
  const post = async (path: string, data: unknown) => {
    const res = await request.post(`/api/${path}`, { headers, data })
    expect(res.status(), path).toBeLessThan(300)
    return res.json()
  }
  const get = async (path: string) => (await request.get(`/api/${path}`, { headers })).json()
  const categories: { id: number; name: string }[] = await get('kakeibo-categories')
  const cat = (name: string) => categories.find((c) => c.name === name)?.id ?? categories[0].id
  const incomeCategories: { id: number }[] = await get('income-categories')
  const bank = await post('accounts', { name: 'みどり銀行', type: 'bank', balance: 250000 })
  await post('accounts', { name: '交通系ICカード', type: 'e_money', balance: 3000 })
  await post('cards', { accountId: bank.id, name: 'いつものクレジット', cardType: 'credit' })
  const today = jstToday()
  await post('incomes', { incomeDate: dayOfThisMonth(1), amount: 280000, content: '給与', categoryId: incomeCategories[0].id, accountId: bank.id })
  for (const [day, amount, purpose, category] of [
    [2, 3200, 'スーパーで買い物', '食費'],
    [4, 1800, 'ドラッグストア', '日用品'],
    [6, 4500, '同僚と夕食', '交際費'],
    [8, 980, '動画サブスク', '趣味・娯楽'],
  ] as const) {
    if (dayOfThisMonth(day) <= today) await post('expenses', { expenseDate: dayOfThisMonth(day), amount, purpose, categoryId: cat(category), accountId: bank.id })
  }
  await post('expenses', { expenseDate: today, amount: 3000, purpose: '友人とランチ', categoryId: cat('交際費'), accountId: bank.id, splitInputType: 'amount', splits: [{ debtorExternalName: 'さとうさん', amountDue: 1500 }] })
  await post('expenses', { expenseDate: today, amount: 2400, purpose: 'ピザの出前', categoryId: cat('食費'), accountId: bank.id, splitInputType: 'amount', splits: [{ debtorExternalName: 'たなかさん', amountDue: 1200 }] })
  await post('fixed-costs', { name: '家賃', amount: 80000, paymentDay: 27, personal: false, includeInHouseholdTotal: true, accountId: bank.id })
  await post('events', { name: '誕生日会', eventDate: dayOfThisMonth(20), isAllDay: true, recurrenceType: 'yearly', personal: false })
  const zaikoCategories: { id: number; name: string }[] = await get('zaiko-categories')
  for (const [name, quantity, threshold, price] of [
    ['卵', 2, 3, 250],
    ['牛乳', 1, 2, 220],
    ['お米', 5, 1, 2500],
    ['トイレットペーパー', 0, 1, 450],
  ] as const) {
    await post('inventory-items', { name, categoryId: zaikoCategories[0].id, storeId: null, quantity, threshold, price })
  }
  const nikujaga = await post('recipes', { title: '肉じゃが', ingredients: 'じゃがいも 3個\n牛肉 200g\n玉ねぎ 1個\nしょうゆ 大さじ3', steps: '1. 材料を切る\n2. 牛肉と玉ねぎを炒める\n3. じゃがいもと調味料を加えて煮る', sourceType: 'manual' })
  const curry = await post('recipes', { title: 'カレーライス', ingredients: 'カレールー 1箱\nにんじん 1本', steps: '1. 野菜を炒める\n2. 煮込んでルーを溶かす', sourceType: 'manual' })
  await request.patch(`/api/recipes/${curry.id}/favorite`, { headers, data: { isFavorite: true } })
  await post('recipes', { title: '鮭のホイル焼き', ingredients: '鮭 2切れ\nきのこ 1パック', steps: '1. ホイルに包んで焼く', sourceType: 'manual' })
  const week = mondayOf(today)
  await post('menu-entries', { weekStartDate: week, recipeId: nikujaga.id })
  await post('menu-entries', { weekStartDate: week, freeTextMemo: '外食' })
}

let baseURL: string | undefined
let watch: (page: Page) => void = () => {}
let storageState: Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>

async function record(browser: Browser, name: string, scenario: (page: Page) => Promise<void>) {
  const dir = join(OUT!, 'raw')
  await mkdir(dir, { recursive: true })
  const context = await browser.newContext({ baseURL, storageState, viewport: VIEWPORT, recordVideo: { dir, size: VIEWPORT }, timezoneId: 'Asia/Tokyo', hasTouch: true })
  const page = await context.newPage()
  watch(page)
  try {
    await scenario(page)
    await page.waitForTimeout(1200)
  } finally {
    const video = page.video()
    await context.close()
    if (video) {
      const target = join(dir, `${name}.webm`)
      await rm(target, { force: true })
      await rename(await video.path(), target)
    }
  }
}

const pause = (page: Page, ms = 900) => page.waitForTimeout(ms)

async function scrollSlowly(page: Page, distance: number) {
  for (let moved = 0; moved < distance; moved += 120) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(160)
  }
}

test('README 用の画面録画', async ({ browser, page, consoleGuard, baseURL: configuredBaseURL }) => {
  test.setTimeout(240_000)
  consoleGuard.watch(page)
  baseURL = configuredBaseURL
  watch = (recorded) => consoleGuard.watch(recorded)
  const user = { email: `e2euser_readme_${Date.now()}@example.com`, password: E2E_PASSWORD, displayName: 'テスト太郎' }
  await register(page, user)
  await createHousehold(page, 'テスト家')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  await seed(page.request, token!)
  storageState = await page.context().storageState()

  await record(browser, 'dashboard', async (p) => {
    await p.goto('/')
    await expect(p.getByText('口座残高合計', { exact: false }).first()).toBeVisible()
    await pause(p, 1500)
    await scrollSlowly(p, 1400)
    await pause(p)
  })

  await record(browser, 'kakeibo', async (p) => {
    await p.goto('/kakeibo')
    await pause(p, 1200)
    await p.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = p.getByTestId('transaction-modal')
    await modal.getByLabel('金額').pressSequentially('1280', { delay: 120 })
    await modal.getByLabel('使用用途（任意）').pressSequentially('パン屋さん', { delay: 120 })
    await pause(p)
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()
    await pause(p)
    await p.getByTestId('transaction-panel').locator('.list-row-button').filter({ hasText: 'パン屋さん' }).click()
    await pause(p, 1800)
    await p.getByRole('dialog', { name: '支出詳細' }).getByRole('button', { name: '閉じる' }).click()
    await pause(p)
  })

  await record(browser, 'warikan', async (p) => {
    await p.goto('/warikan')
    await pause(p, 1200)
    await p.getByRole('list', { name: '割り勘の内訳一覧' }).getByRole('button', { name: /友人とランチ/ }).click()
    const detail = p.getByRole('dialog', { name: '割り勘詳細' })
    await pause(p, 1500)
    await detail.getByRole('button', { name: '精算済みにする' }).click()
    await pause(p)
    await p.getByTestId('settlement-account-modal').getByRole('button', { name: '精算済みにする' }).click()
    await expect(detail).toContainText('精算済み')
    await pause(p, 1500)
  })

  await record(browser, 'fixed-costs', async (p) => {
    await p.goto('/fixed-costs')
    await pause(p, 1200)
    await p.getByRole('button', { name: '固定費を登録' }).click()
    await p.getByLabel('固定費名').pressSequentially('スマホ代', { delay: 120 })
    await p.getByLabel('金額').pressSequentially('6000', { delay: 120 })
    await p.getByLabel('支払日').fill('25')
    await pause(p)
    await p.getByRole('button', { name: '登録', exact: true }).click()
    await expect(p.getByTestId('fixed-costs-panel')).toContainText('スマホ代')
    await pause(p, 1500)
  })

  await record(browser, 'accounts', async (p) => {
    await p.goto('/accounts')
    await pause(p, 1500)
    await p.getByRole('button', { name: '口座を登録' }).click()
    await p.getByLabel('口座名').pressSequentially('つみたて口座', { delay: 120 })
    await p.getByLabel('初期残高').fill('50000')
    await pause(p)
    await p.getByRole('button', { name: '登録', exact: true }).click()
    await expect(p.getByRole('table', { name: '口座一覧' })).toContainText('つみたて口座')
    await pause(p, 1500)
  })

  await record(browser, 'zaiko', async (p) => {
    await p.goto('/zaiko')
    await pause(p, 1200)
    await p.getByRole('button', { name: '卵の詳細', exact: true }).click()
    await pause(p)
    const detail = p.getByRole('dialog').first()
    const plus = detail.getByRole('button', { name: /増やす/ }).first()
    await plus.click()
    await pause(p, 400)
    await plus.click()
    await expect(detail.locator('.qty-value')).toHaveText('4.0')
    await pause(p)
    await detail.getByRole('button', { name: 'キャンセル', exact: true }).click()
    await expect(detail).toBeHidden()
    await expect(p.getByRole('button', { name: '卵の詳細', exact: true })).toContainText('4.0')
    await pause(p)
    await p.getByRole('navigation', { name: '在庫管理関連機能' }).getByRole('link', { name: '買い物リスト' }).click()
    await pause(p, 1800)
  })

  await record(browser, 'recipes', async (p) => {
    await p.goto('/recipes')
    await pause(p, 1200)
    await p.getByRole('button', { name: 'レシピを登録' }).click()
    await p.getByLabel('タイトル').pressSequentially('豚の生姜焼き', { delay: 120 })
    await p.getByLabel('材料').pressSequentially('豚ロース 300g\n生姜 1かけ', { delay: 60 })
    await p.getByLabel('手順').pressSequentially('1. タレに漬けて焼く', { delay: 60 })
    await pause(p)
    await p.getByRole('button', { name: '登録', exact: true }).click()
    await expect(p.getByTestId('recipes-panel')).toContainText('豚の生姜焼き')
    await pause(p)
    await p.getByTestId('recipes-panel').getByText('肉じゃが').first().click()
    await pause(p, 2000)
  })

  await record(browser, 'menu', async (p) => {
    await p.goto('/menu')
    const menu = p.getByTestId('menu-panel')
    await pause(p, 1200)
    await menu.getByLabel('レシピを検索').pressSequentially('カレー', { delay: 150 })
    await menu.getByRole('radio', { name: '★ カレーライス', exact: true }).check()
    await pause(p)
    await menu.getByRole('button', { name: '追加', exact: true }).click()
    await expect(menu.getByRole('button', { name: 'カレーライス' })).toBeVisible()
    await pause(p)
    await menu.getByRole('button', { name: '肉じゃが' }).click()
    await pause(p, 2000)
  })

  await record(browser, 'settings', async (p) => {
    await p.goto('/')
    await pause(p, 800)
    await p.getByRole('link', { name: '設定を開く' }).click()
    await pause(p, 1200)
    await p.getByRole('link', { name: 'アカウント設定を開く' }).click()
    await pause(p, 1200)
    await scrollSlowly(p, 1500)
    await pause(p)
  })
})
