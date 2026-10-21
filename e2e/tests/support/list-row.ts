import type { Locator, Page } from '@playwright/test'
import { expect } from '../console-guard'

export async function checkRow(page: Page, row: Locator, width: number, dialogName: string) {
  await expect(row).toHaveCount(1)
  expect(await row.evaluate(el => el.tagName)).toBe('BUTTON')
  await expect(row.locator('button')).toHaveCount(0)
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await row.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(row).toBeFocused()
  await row.press('Enter')
  const dialog = page.getByRole('dialog', { name: dialogName })
  const editing = dialogName === 'イベントを編集'
  const close = dialog.getByRole('button', { name: editing ? 'キャンセル' : '閉じる', exact: true })
  const initial = editing ? dialog.getByLabel('イベント名', { exact: true }) : close
  await expect(initial).toBeFocused()
  await page.keyboard.press('Tab')
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Shift+Tab')
  await expect(initial).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(row).toBeFocused()
  await row.press('Space')
  await close.click()
  await expect(row).toBeFocused()
  if (editing) { await row.press('Tab'); await page.keyboard.press('Shift+Tab'); await expect(row).toBeFocused() }
  const focus = await row.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, outline: getComputedStyle(el).outlineStyle }))
  expect(focus.outline).toBe('solid')
  if (width === 1280) {
    await row.hover()
    expect(await row.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(focus.background)
  }
  for (let i = 0; i < 3; i++) {
    const cell = row.locator(':scope > span').nth(i)
    if (width === 1280) await cell.click()
    else await cell.tap()
    await expect(dialog).toBeVisible()
    await close.click()
    await expect(row).toBeFocused()
  }
  for (const edge of ['left', 'right']) {
    const box = (await row.boundingBox())!
    const position = { x: edge === 'left' ? 2 : box.width - 2, y: box.height / 2 }
    if (width === 1280) await row.click({ position })
    else await row.tap({ position })
    await expect(dialog).toBeVisible()
    await close.click()
    await expect(row).toBeFocused()
  }
}
