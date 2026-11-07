import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function openAdd(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'レシピを追加' })
  if (!await sheet.isVisible()) await page.getByTestId('menu-panel').getByRole('button', { name: 'レシピを追加', exact: true }).click()
  return sheet
}

test.describe('F-09/F-10 レシピ・献立', () => {
  test('手動でレシピを登録し、今週の献立に割り当てられる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'kondate')
    await page.goto('/recipes')

    const title = '[E2E_TEST] 肉じゃが'
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill(title)
    await page.getByLabel('材料').fill('じゃがいも、牛肉、玉ねぎ')
    await page.getByLabel('手順').fill('煮る')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('recipes-panel')).toContainText(title)

    await page.goto('/menu')
    const menu = page.getByTestId('menu-panel')
    // キーワードで絞り込んでから選ぶ(#281)。
    await (await openAdd(page)).getByLabel('レシピを検索').fill('肉じゃ')
    await (await openAdd(page)).getByRole('checkbox', { name: title, exact: true }).check()
    await (await openAdd(page)).getByRole('button', { name: '追加', exact: true }).click()
    await expect(menu.getByRole('listitem').filter({ hasText: title })).toBeVisible()

    // 自由メモでも追加できる
    await (await openAdd(page)).getByLabel('自由メモ', { exact: true }).check()
    await (await openAdd(page)).getByLabel('自由メモの内容').fill('[E2E_TEST] 外食')
    await (await openAdd(page)).getByRole('button', { name: '追加', exact: true }).click()
    await expect(menu.getByRole('listitem').filter({ hasText: '[E2E_TEST] 外食' })).toBeVisible()
  })

  for (const width of [1280, 390, 320]) {
    test(`${width}pxで矢印による週移動・復帰と横はみ出しを検証する`, async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await page.setViewportSize({ width: 1280, height: 800 })
      await setupUserWithHousehold(page, `menu${width}`)
      await page.goto('/menu')
      const menu = page.getByTestId('menu-panel')
      const weekLabel = menu.locator('.toolbar > span')
      await expect(weekLabel).toHaveText(/\d{4}-\d{2}-\d{2} の週/)
      const monday = (await weekLabel.innerText()).split(' ')[0]
      const shiftedLabel = (delta: number) => {
        const date = new Date(`${monday}T12:00:00Z`)
        date.setUTCDate(date.getUTCDate() + delta * 7)
        return `${date.toISOString().slice(0, 10)} の週`
      }
      const memo = `[E2E_TEST] menu${width}`
      await (await openAdd(page)).getByLabel('自由メモ', { exact: true }).check()
      await (await openAdd(page)).getByLabel('自由メモの内容').fill(memo)
      await (await openAdd(page)).getByRole('button', { name: '追加', exact: true }).click()
      await expect(menu.getByRole('listitem').filter({ hasText: memo })).toBeVisible()
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })

      const assertLayout = async () => {
        await expect(menu).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const elements = [menu, menu.getByRole('button', { name: '先週', exact: true }), weekLabel, menu.getByRole('button', { name: '次週', exact: true })]
        const boxes = []
        for (const element of elements) {
          const box = await element.boundingBox()
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
          boxes.push(box!)
        }
        for (let i = 1; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j]
            expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
          }
        }
      }
      for (const [name, arrow] of [['先週', '◀'], ['次週', '▶']]) {
        const button = menu.getByRole('button', { name, exact: true })
        await expect(button).toHaveText(arrow)
        await expect(button).toHaveAccessibleName(name)
        await expect(button.locator('span')).toHaveAttribute('aria-hidden', 'true')
      }
      await assertLayout()
      for (const [name, delta] of [['先週', -1], ['次週', 0], ['次週', 1], ['先週', 0]] as const) {
        await menu.getByRole('button', { name, exact: true }).click()
        await expect(weekLabel).toHaveText(shiftedLabel(delta))
        if (delta === 0) await expect(menu.getByRole('listitem').filter({ hasText: memo })).toBeVisible()
        else {
          await expect(menu.getByRole('listitem').filter({ hasText: memo })).toHaveCount(0)
          await expect(menu.getByRole('listitem')).toHaveText('この週の献立はまだありません')
        }
        await assertLayout()
      }
      // 保存先は実行時だけ指定し、個人環境の絶対パスをリポジトリに持たせない。
      if (process.env.ISSUE_218_SHOTS_DIR) {
        await mkdir(process.env.ISSUE_218_SHOTS_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.ISSUE_218_SHOTS_DIR, `menu-${width}.png`), fullPage: true })
      }
    })
  }

  for (const width of [390, 320]) {
    test(`${width}pxでレシピ検索欄と選択欄がはみ出さない (#281)`, async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await page.setViewportSize({ width, height: 844 })
      await setupUserWithHousehold(page, `menuSearch${width}`)
      await page.goto('/menu')
      const menu = page.getByTestId('menu-panel')
      await (await openAdd(page)).getByLabel('レシピを検索').fill('[E2E_TEST] 該当なし')
      await expect(page.getByRole('dialog', { name: 'レシピを追加' }).getByRole('group', { name: 'レシピ候補' })).toContainText('該当するレシピがありません')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      for (const element of [page.getByRole('dialog', { name: 'レシピを追加' }).getByLabel('レシピを検索'), page.getByRole('dialog', { name: 'レシピを追加' }).getByRole('group', { name: 'レシピ候補' })]) {
        const box = (await element.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      const dir = process.env.MENU_SEARCH_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `menu-search-${width}.png`), fullPage: true }) }
    })
  }

  for (const width of [1280, 390, 320]) {
    test(`${width}px 献立に追加したレシピのタイトルから詳細を開ける (#289)`, async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await page.setViewportSize({ width, height: 844 })
      await setupUserWithHousehold(page, `menuLink${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const title = '[E2E_TEST] 献立リンクのレシピ'
      const created = await page.request.post('/api/recipes', {
        headers: { Authorization: `Bearer ${token}` },
        data: { title, ingredients: '[E2E_TEST] じゃがいも', steps: null, sourceType: 'manual' },
      })
      expect(created.status()).toBe(201)
      await page.goto('/menu')
      const menu = page.getByTestId('menu-panel')
      await (await openAdd(page)).getByRole('checkbox', { name: title, exact: true }).check()
      await (await openAdd(page)).getByRole('button', { name: '追加', exact: true }).click()
      await menu.getByRole('button', { name: title, exact: true }).click()
      await menu.getByRole('button', { name: 'レシピを見る', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'レシピ詳細' })
      await expect(dialog).toContainText('[E2E_TEST] じゃがいも')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const dir = process.env.MENU_SEARCH_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `menu-link-${width}.png`), fullPage: true }) }
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
      await expect(dialog).toBeHidden()
    })
  }
})

for (const width of [1280, 390, 320]) {
  test(width + 'px: 献立は上部シートで複数追加し長名展開・原本参照・確認削除ができる (#419)', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await setupUserWithHousehold(page, 'menu_uiux_' + width)
    const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
    const long = '[E2E_TEST] ' + '長い料理タイトル'.repeat(8)
    const manual = '[E2E_TEST] 手入力料理'
    for (const data of [
      { title: long, sourceType: 'manual', ingredients: null },
      { title: manual, sourceType: 'manual', ingredients: '[E2E_TEST] じゃがいも' },
    ]) expect((await page.request.post('/api/recipes', { headers, data })).status()).toBe(201)
    // 外部サイト取得を行わず、WEB表示だけを局所fixtureで検証する。献立の保存は実API。
    await page.route('**/api/recipes', async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return }
      const response = await route.fetch()
      const recipes = await response.json()
      await route.fulfill({ response, json: recipes.map((recipe: { title: string }) => recipe.title === long ? { ...recipe, sourceType: 'web', url: 'https://recipe.example.com/menu419' } : recipe) })
    })
    await page.goto('/menu')
    const menu = page.getByTestId('menu-panel')
    const trigger = menu.getByRole('button', { name: 'レシピを追加', exact: true })
    await expect(menu.getByRole('searchbox')).toHaveCount(0)
    const sheet = await openAdd(page)
    const candidateTitle = sheet.getByRole('button', { name: long, exact: true })
    await expect(candidateTitle).toHaveAttribute('aria-expanded', 'false')
    const label = candidateTitle.locator('.menu-title-text')
    expect(await label.evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe('2')
    await candidateTitle.click()
    await expect(candidateTitle).toHaveAttribute('aria-expanded', 'true')
    await expect(sheet.getByRole('checkbox', { name: long, exact: true })).not.toBeChecked()
    await candidateTitle.click()
    await expect(candidateTitle).toHaveAttribute('aria-expanded', 'false')
    await expect(sheet.getByText('recipe.example.com', { exact: true })).toBeVisible()
    const checkTarget = sheet.getByRole('checkbox', { name: long, exact: true })
    const hitTarget = checkTarget.locator('xpath=ancestor::label[1]')
    await expect(hitTarget).toBeVisible()
    const hitBox = await hitTarget.boundingBox()
    expect(hitBox!.width).toBeGreaterThanOrEqual(44)
    expect(hitBox!.height).toBeGreaterThanOrEqual(44)
    // 24pxのinput外にある選択label余白でもチェックでき、タイトルは展開しない。
    await hitTarget.click({ position: { x: 2, y: 2 } })
    await expect(checkTarget).toBeChecked()
    await expect(candidateTitle).toHaveAttribute('aria-expanded', 'false')
    await sheet.getByRole('checkbox', { name: manual, exact: true }).check()
    await sheet.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(trigger).toBeFocused()
    await openAdd(page)
    await expect(sheet.getByRole('checkbox', { name: long, exact: true })).toBeChecked()
    expect(await sheet.getByRole('searchbox').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await sheet.getByRole('button', { name: '追加', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(menu.locator('.menu-list-row')).toHaveCount(2)
    const listTitle = menu.getByRole('button', { name: long, exact: true })
    await listTitle.click()
    const link = menu.getByRole('link', { name: 'レシピを見る' })
    await expect(link).toHaveAttribute('href', 'https://recipe.example.com/menu419')
    await expect(link).toHaveAttribute('target', '_blank')
    await listTitle.click()
    await expect(link).toBeHidden()
    const manualRow = menu.locator('.menu-list-row').filter({ hasText: manual })
    await manualRow.getByRole('button', { name: manual, exact: true }).click()
    await manualRow.getByRole('button', { name: 'レシピを見る', exact: true }).click()
    const detail = page.getByRole('dialog', { name: 'レシピ詳細' })
    await expect(detail).toContainText('[E2E_TEST] じゃがいも')
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()
    const remove = manualRow.getByRole('button', { name: '削除', exact: true })
    await remove.click()
    const confirmation = page.getByRole('dialog', { name: '献立を削除' })
    await expect(confirmation).toContainText('レシピ原本は削除されません')
    await confirmation.getByRole('button', { name: 'キャンセル' }).click()
    await expect(remove).toBeFocused()
    await expect(manualRow).toBeVisible()
    await remove.click()
    await confirmation.getByRole('button', { name: '献立から削除' }).click()
    await expect(menu.locator('.menu-list-row')).toHaveCount(1)
    const recipes = await (await page.request.get('/api/recipes', { headers })).json()
    expect(recipes.some((recipe: { title: string }) => recipe.title === manual)).toBe(true)
    const [triggerBox, listBox] = await Promise.all([trigger.boundingBox(), menu.locator('.menu-list').boundingBox()])
    expect(triggerBox!.y).toBeLessThan(listBox!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}
