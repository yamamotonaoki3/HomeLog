import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('実Workersのscheduled経路で過去週だけが消え、今週・未来と元レシピは残る (#362)', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'menu_cleanup')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  jstNow.setUTCDate(jstNow.getUTCDate() - ((jstNow.getUTCDay() + 6) % 7))
  const week = (offset: number) => {
    const date = new Date(jstNow)
    date.setUTCDate(date.getUTCDate() + offset * 7)
    return date.toISOString().slice(0, 10)
  }
  const recipeResponse = await page.request.post('/api/recipes', { headers, data: { title: '[E2E_TEST] cleanup recipe' } })
  expect(recipeResponse.status()).toBe(201)
  const recipe = await recipeResponse.json()
  const ids = new Map<string, number[]>()
  for (const offset of [-2, -1, 0, 1]) {
    const weekStartDate = week(offset)
    const weekIds = []
    for (const entry of [{ recipeId: recipe.id }, { freeTextMemo: '[E2E_TEST] cleanup memo' }]) {
      const response = await page.request.post('/api/menu-entries', { headers, data: { weekStartDate, ...entry } })
      expect(response.status()).toBe(201)
      weekIds.push((await response.json()).id)
    }
    ids.set(weekStartDate, weekIds)
  }
  const readWeek = async (offset: number) => {
    const response = await page.request.get(`/api/menu-entries?weekStartDate=${week(offset)}`, { headers })
    expect(response.status()).toBe(200)
    return response.json()
  }
  expect(await readWeek(-1)).toHaveLength(2)
  // Wranglerのローカル開発専用経路。本番用の削除エンドポイントは追加しない。
  const trigger = async () => {
    const response = await request.get('http://localhost:8787/__scheduled?cron=0+15+*+*+*')
    expect(response.ok()).toBe(true)
    expect(await response.text()).toBe('Ran scheduled event')
  }
  await trigger()
  await expect.poll(async () => (await readWeek(-1)).length).toBe(0)
  expect(await readWeek(-2)).toEqual([])
  for (const offset of [0, 1]) {
    const rows = await readWeek(offset)
    expect(rows.map((row: { id: number }) => row.id)).toEqual(ids.get(week(offset)))
    expect(rows[0]).toMatchObject({ recipeId: recipe.id, recipeTitle: '[E2E_TEST] cleanup recipe' })
  }
  const recipesResponse = await page.request.get('/api/recipes', { headers })
  expect(recipesResponse.status()).toBe(200)
  expect(await recipesResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: recipe.id })]))
  await trigger()
  expect(await readWeek(-1)).toEqual([])
  expect(await readWeek(0)).toHaveLength(2)
})
