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
  // 在庫は品目に合うカテゴリーへ入れる。既定に無い「日用品」はその場で追加する。
  const zaikoCategories: { id: number; name: string }[] = [...await get('zaiko-categories'), await post('zaiko-categories', { name: '日用品' })]
  const zaikoCat = (name: string) => zaikoCategories.find((c) => c.name === name)?.id ?? zaikoCategories[0].id
  for (const [name, category, quantity, threshold, price] of [
    ['卵', '卵', 2, 3, 250],
    ['牛乳', '乳製品', 1, 2, 220],
    ['お米', '乾物', 5, 1, 2500],
    ['トイレットペーパー', '日用品', 0, 1, 450],
  ] as const) {
    await post('inventory-items', { name, categoryId: zaikoCat(category), storeId: null, quantity, threshold, price })
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

// WEB 登録の録画に使う架空のレシピページ(#522)。recipe.example.com は予約ドメインで、実在のサイトではない。
const WEB_RECIPE_URL = 'https://recipe.example.com/teriyaki-chicken'
const WEB_RECIPE_THUMBNAIL = 'https://recipe.example.com/images/teriyaki-chicken.svg'
// サムネイルは自作の絵(皿に盛った鶏の照り焼き)。詳細では中央を切り取って表示されるので、料理を中央に置く。
const WEB_RECIPE_THUMBNAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">
<rect width="800" height="420" fill="#f6e7cf"/>
<rect y="300" width="800" height="120" fill="#e9d2ad"/>
<ellipse cx="400" cy="232" rx="250" ry="130" fill="#d9cbb7"/>
<ellipse cx="400" cy="222" rx="250" ry="130" fill="#ffffff"/>
<ellipse cx="400" cy="222" rx="196" ry="98" fill="#f4f1ec"/>
<g fill="#5e9e3d"><circle cx="262" cy="214" r="34"/><circle cx="292" cy="178" r="30"/><circle cx="300" cy="246" r="28"/></g>
<g fill="#7dbb55"><circle cx="276" cy="200" r="16"/><circle cx="300" cy="236" r="12"/></g>
<g stroke="#5a2f12" stroke-width="3">
<rect x="330" y="160" width="96" height="72" rx="26" fill="#a5582a"/>
<rect x="408" y="176" width="96" height="72" rx="26" fill="#9a4f24"/>
<rect x="356" y="220" width="96" height="66" rx="26" fill="#ab5e2d"/>
</g>
<g fill="#e7a56d" opacity="0.75"><rect x="346" y="172" width="44" height="10" rx="5"/><rect x="424" y="190" width="44" height="10" rx="5"/><rect x="372" y="234" width="44" height="10" rx="5"/></g>
<g fill="#fff8e6"><circle cx="372" cy="200" r="3"/><circle cx="396" cy="186" r="3"/><circle cx="452" cy="214" r="3"/><circle cx="476" cy="200" r="3"/><circle cx="404" cy="258" r="3"/><circle cx="428" cy="248" r="3"/></g>
<g fill="#f2c94c"><circle cx="530" cy="262" r="20"/><circle cx="552" cy="238" r="16"/></g>
<path d="M512 262 a20 20 0 0 1 36 0" fill="none" stroke="#e0a91f" stroke-width="3"/>
</svg>`

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
    await p.getByRole('button', { name: '収支を登録', exact: true }).click()
    const modal = p.getByTestId('transaction-modal')
    await modal.getByLabel('金額').pressSequentially('1280', { delay: 120 })
    await modal.getByLabel('使用用途（任意）').pressSequentially('パン屋さん', { delay: 120 })
    await pause(p)
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()
    await pause(p)
    await p.getByTestId('transaction-panel').locator('.list-row-button').filter({ hasText: 'パン屋さん' }).click()
    await pause(p, 1800)
    await p.getByRole('dialog', { name: '支出詳細' }).getByRole('button', { name: '閉じる', exact: true }).click()
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
    await expect(p.getByRole('list', { name: '口座一覧' })).toContainText('つみたて口座')
    await pause(p, 1500)
  })

  await record(browser, 'zaiko', async (p) => {
    await p.goto('/zaiko')
    await pause(p, 1200)
    // 行を押すと、その場に数量の操作欄が開く。＋は押すたびに保存される。
    const row = p.getByRole('button', { name: '卵の詳細', exact: true })
    await row.click()
    const operations = p.getByRole('region', { name: '卵の数量変更', exact: true })
    await expect(operations).toBeVisible()
    await pause(p)
    const plus = operations.getByRole('button', { name: '卵を増やす', exact: true })
    await plus.click()
    await expect(row).toContainText('3.0')
    await pause(p, 500)
    await plus.click()
    await expect(row).toContainText('4.0')
    await pause(p, 1200)
    await p.getByRole('navigation', { name: '在庫管理関連機能' }).getByRole('link', { name: '買い物リスト' }).click()
    const shopping = p.getByTestId('shopping-panel')
    await expect(shopping).toContainText('牛乳')
    await pause(p, 1200)
    // 買った数を＋で合わせると、その行にチェックが付く(在庫へは「購入を反映」で確定するまで入らない)。
    await shopping.getByRole('button', { name: '牛乳の購入数を1増やす', exact: true }).click()
    await expect(shopping.getByRole('group', { name: '牛乳の購入数', exact: true })).toContainText('2')
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

  // WEB タブで URL から登録する(#522)。外部サイトには接続しない: サーバーがページを読みに行く
  // POST /api/recipes/from-url とサムネイル画像だけを、架空の応答に差し替える。一覧の取得は本物の API。
  await record(browser, 'recipes-web', async (p) => {
    const added: unknown[] = []
    await p.route(WEB_RECIPE_THUMBNAIL, (route) => route.fulfill({ contentType: 'image/svg+xml', body: WEB_RECIPE_THUMBNAIL_SVG }))
    await p.route('**/api/recipes/from-url', async (route) => {
      const body = route.request().postDataJSON()
      expect(body.url).toBe(WEB_RECIPE_URL)
      const recipe = { id: 900001, title: '鶏の照り焼き', sourceType: 'web', url: body.url, memo: body.memo ?? null, ingredients: null, steps: null, thumbnailUrl: WEB_RECIPE_THUMBNAIL, isFavorite: false }
      added.push(recipe)
      await route.fulfill({ status: 201, json: recipe })
    })
    await p.route('**/api/recipes', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, json: [...await response.json(), ...added] })
    })
    await p.goto('/recipes')
    await pause(p, 1200)
    await p.getByRole('button', { name: 'レシピを登録' }).click()
    await pause(p, 600)
    await p.getByRole('tab', { name: 'WEB' }).click()
    await pause(p)
    await p.getByLabel('レシピURL').fill(WEB_RECIPE_URL)
    await pause(p)
    await p.getByLabel('メモ').pressSequentially('週末に作る', { delay: 150 })
    await pause(p)
    await p.getByRole('button', { name: '登録', exact: true }).click()
    const card = p.getByRole('list', { name: 'レシピ' }).getByRole('button', { name: '鶏の照り焼き', exact: true })
    await expect(card).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await pause(p, 1500)
    await card.click()
    const detail = p.getByRole('dialog', { name: 'レシピ詳細' })
    await expect(detail.getByRole('img', { name: '鶏の照り焼きのサムネイル' })).toBeVisible()
    await expect(detail).toContainText('週末に作る')
    await pause(p, 2500)
  })

  await record(browser, 'menu', async (p) => {
    await p.goto('/menu')
    const menu = p.getByTestId('menu-panel')
    await pause(p, 1200)
    await menu.getByRole('button', { name: 'レシピを追加', exact: true }).click()
    const sheet = p.getByRole('dialog', { name: '献立に追加する' })
    await sheet.getByLabel('レシピを検索').pressSequentially('カレー', { delay: 150 })
    await sheet.getByRole('checkbox', { name: 'カレーライス', exact: true }).check()
    await pause(p)
    await sheet.getByRole('button', { name: /^(選択した\d+件を)?追加$/ }).click()
    await expect(menu.getByRole('button', { name: 'カレーライス' })).toBeVisible()
    await pause(p)
    await menu.getByRole('button', { name: '肉じゃが', exact: true }).click()
    await menu.getByRole('button', { name: 'レシピを見る', exact: true }).click()
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
