import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('390px: 献立の部分成功後は成功済みを再送せず、失敗分と未送信分だけ追加する (#419)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'menu_partial_save')
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
  const titles = ['[E2E_TEST] 献立の追加A', '[E2E_TEST] 献立の追加B', '[E2E_TEST] 献立の追加C']
  const recipeIds: number[] = []
  for (const title of titles) {
    const response = await page.request.post('/api/recipes', { headers, data: { title, sourceType: 'manual' } })
    expect(response.status()).toBe(201)
    recipeIds.push((await response.json()).id)
  }

  const attempts: number[] = []
  let weekStartDate = ''
  let failedB = false
  consoleGuard.allow({ url: /\/api\/menu-entries$/, message: /^Failed to load resource:.*400/ })
  await page.route('**/api/menu-entries', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const body = request.postDataJSON() as { recipeId: number; weekStartDate: string }
    attempts.push(body.recipeId)
    if (!weekStartDate) weekStartDate = body.weekStartDate
    expect(body.weekStartDate).toBe(weekStartDate)
    if (body.recipeId === recipeIds[1] && !failedB) {
      failedB = true
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'VALIDATION_ERROR', message: '[E2E_TEST] Bの初回追加は書き込み前に拒否' }),
      })
    }
    // Aと再試行のB/Cは実際のローカルWorkersへ保存する。
    return route.continue()
  })

  await page.goto('/menu')
  await page.getByRole('button', { name: 'レシピを追加', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '献立に追加する', exact: true })
  const submit = sheet.getByRole('button', { name: /^(選択した\d+件を)?追加$/ })
  for (const title of titles) await sheet.getByRole('checkbox', { name: title, exact: true }).check()
  expect(attempts).toEqual([])

  const failedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/menu-entries' && response.status() === 400,
  )
  await submit.click()
  await failedResponse
  await expect(submit).toBeEnabled()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('checkbox', { name: titles[0], exact: true })).not.toBeChecked()
  for (const title of titles.slice(1)) await expect(sheet.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
  expect(attempts).toEqual(recipeIds.slice(0, 2))

  type SavedEntry = { recipeId: number | null }
  const savedRecipeIds = async () => {
    const response = await page.request.get(`/api/menu-entries?weekStartDate=${encodeURIComponent(weekStartDate)}`, { headers })
    expect(response.status()).toBe(200)
    return (await response.json() as SavedEntry[]).map((entry) => entry.recipeId)
  }
  expect(await savedRecipeIds()).toEqual([recipeIds[0]])

  await submit.click()
  await expect(sheet).toBeHidden()
  expect(attempts).toEqual([recipeIds[0], recipeIds[1], recipeIds[1], recipeIds[2]])
  const saved = await savedRecipeIds()
  expect(saved).toHaveLength(3)
  for (const recipeId of recipeIds) expect(saved.filter((id) => id === recipeId)).toHaveLength(1)
})

test('390px: 献立保存後の500は結果不明として再送を止め、再表示しても理由を保持する (#419)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setupUserWithHousehold(page, 'menu_committed_unknown')
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
  const title = '[E2E_TEST] 応答が不明な献立'
  const recipeResponse = await page.request.post('/api/recipes', { headers, data: { title, sourceType: 'manual' } })
  expect(recipeResponse.status()).toBe(201)
  const recipeId = (await recipeResponse.json()).id as number
  let attempts = 0
  let weekStartDate = ''
  consoleGuard.allow({ url: /\/api\/menu-entries$/, message: /^Failed to load resource:.*500/ })
  await page.route('**/api/menu-entries', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts++
    weekStartDate = (route.request().postDataJSON() as { weekStartDate: string }).weekStartDate
    // 実Workersの201で保存済みであることを確定してから、ブラウザに500を返す。
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '[E2E_TEST] 保存後に応答が不明' }),
    })
  })

  await page.goto('/menu')
  const trigger = page.getByRole('button', { name: 'レシピを追加', exact: true })
  await trigger.click()
  const sheet = page.getByRole('dialog', { name: '献立に追加する', exact: true })
  await sheet.getByRole('checkbox', { name: title, exact: true }).check()
  await sheet.getByRole('button', { name: /^(選択した\d+件を)?追加$/ }).click()
  await expect(sheet.getByRole('alert')).toContainText('再送せず')
  await expect(sheet.getByRole('button', { name: /^(選択した\d+件を)?追加$/ })).toBeDisabled()
  await expect(sheet.getByRole('checkbox', { name: title, exact: true })).toBeDisabled()
  expect(attempts).toBe(1)

  await sheet.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('menu-panel').getByRole('listitem').filter({ hasText: title })).toHaveCount(1)
  await trigger.click()
  await expect(sheet.getByRole('alert')).toContainText('再送せず')
  await expect(sheet.getByRole('alert')).toContainText('画面を再読み込み')
  await expect(sheet.getByRole('button', { name: /^(選択した\d+件を)?追加$/ })).toBeDisabled()
  expect(attempts).toBe(1)

  const entriesResponse = await page.request.get(`/api/menu-entries?weekStartDate=${encodeURIComponent(weekStartDate)}`, { headers })
  expect(entriesResponse.status()).toBe(200)
  const entries = await entriesResponse.json() as { recipeId: number | null }[]
  expect(entries).toHaveLength(1)
  expect(entries[0].recipeId).toBe(recipeId)
})
