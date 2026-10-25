import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`S-04 ${width}px 献立から閲覧専用詳細を開閉する`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await setupUserWithHousehold(page, `dashboard_recipe_${width}`)
    const title = '[E2E_TEST] 長い献立タイトル' + '日本語'.repeat(12) + 'abcdefgh'.repeat(5)
    const ingredient = '[E2E_TEST] 材料' + 'abcdefgh'.repeat(50)
    const step = '[E2E_TEST] 手順' + '長い説明'.repeat(60)
    await page.goto('/recipes')
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill(title)
    await page.getByLabel('材料', { exact: true }).fill(ingredient)
    await page.getByLabel('手順', { exact: true }).fill(Array.from({ length: 8 }, () => step).join('\n'))
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('recipes-panel')).toContainText(title)
    // 一覧では従来の編集・削除が維持される。
    await page.getByRole('button', { name: title, exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'レシピ詳細' })
    await expect(dialog.getByRole('button', { name: '編集', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '削除', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '閉じる' }).click()

    await page.goto('/menu')
    await page.getByRole('radio', { name: title, exact: true }).check()
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible()
    await page.getByLabel('自由メモ', { exact: true }).check()
    await page.getByLabel('自由メモの内容').fill('[E2E_TEST] 外食')
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '[E2E_TEST] 外食' })).toBeVisible()
    await page.goto('/')
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    const list = page.getByRole('list', { name: '今週の献立' })
    const button = list.getByRole('button', { name: title, exact: true })
    await expect(button).toBeVisible()
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByText('[E2E_TEST] 外食')).toBeVisible()
    const assertWidth = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    const shot = async (name: string) => {
      if (process.env.ISSUE_211_SHOTS_DIR) {
        await mkdir(process.env.ISSUE_211_SHOTS_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.ISSUE_211_SHOTS_DIR, `${name}-${width}.png`), fullPage: true })
      }
    }
    await assertWidth()
    await shot('dashboard')
    for (const close of ['button', 'escape', 'overlay'] as const) {
      await button.focus()
      await button.press(close === 'escape' ? 'Space' : 'Enter')
      dialog = page.getByRole('dialog', { name: 'レシピ詳細' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
      await expect(dialog.getByRole('list', { name: '材料' })).toHaveText(ingredient)
      await expect(dialog.getByRole('list', { name: '手順' }).getByRole('listitem')).toHaveCount(8)
      await expect(dialog.getByRole('button', { name: '編集' })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: '削除' })).toHaveCount(0)
      await assertWidth()
      expect(await dialog.locator('.recipe-detail-modal').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await dialog.getByRole('heading', { name: title }).click()
      await expect(dialog).toBeVisible()
      if (close === 'button') {
        await dialog.locator('.recipe-detail-modal').evaluate((el) => { el.scrollTop = 0 })
        await shot('recipe-detail')
        await dialog.getByRole('button', { name: '閉じる' }).click()
      } else if (close === 'escape') await page.keyboard.press('Escape')
      else await dialog.click({ position: { x: 2, y: 2 } })
      await expect(dialog).toBeHidden()
      await expect(button).toBeFocused()
    }
  })
}
