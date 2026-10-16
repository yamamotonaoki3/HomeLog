import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { addTransaction, getInviteCode, joinHousehold, register, setupUserWithHousehold } from './support/flows'
import { newUser } from './support/test-data'

async function addExternalExpense(page: Page, purpose: string, externalName: string) {
  await page.getByRole('button', { name: '登録', exact: true }).first().click()
  const modal = page.getByTestId('transaction-modal')
  await modal.getByLabel('金額').fill('3000')
  await modal.getByLabel('使用用途（任意）').fill(purpose)
  await modal.getByLabel('割り勘する').check()
  await modal.getByLabel('割り勘の相手の種別').selectOption('external')
  await modal.getByLabel('世帯外の人の名前').fill(externalName)
  await expect(modal.getByLabel('負担割合（％）')).toHaveValue('50')
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/expenses') && response.request().method() === 'POST')
  await modal.getByRole('button', { name: '登録', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const created = await response.json()
  expect(created.splits).toEqual([expect.objectContaining({ amountDue: 1500, splitRatio: 50, status: 'unpaid' })])
  await expect(modal).toBeHidden()
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  expect(token).toBeTruthy()
  const listResponse = await page.request.get('/api/expense-splits', { headers: { Authorization: `Bearer ${token}` } })
  expect(listResponse.status()).toBe(200)
  const list = await listResponse.json()
  expect(list).toEqual(expect.arrayContaining([expect.objectContaining({
    expenseId: created.id, expensePurpose: purpose, debtorLabel: externalName,
    role: 'payer', isExternal: true, amountDue: 1500, status: 'unpaid',
  })]))
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - width),
      outside: [...document.querySelectorAll('body *')].filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.right > width
      }).map((element) => ({ tag: element.tagName, class: element.className })),
    }
  })).toEqual({ overflow: 0, outside: [] })
}

async function screenshot(page: Page, width: number, name = 'warikan') {
  // 任意のローカル保存先を指定した実行でのみ撮影。リポジトリには保存しない。
  if (process.env.WARIKAN_SCREENSHOT_DIR) {
    await mkdir(process.env.WARIKAN_SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: join(process.env.WARIKAN_SCREENSHOT_DIR, `${name}-${width}.png`), fullPage: true })
  }
}

// 一覧の行(日付・相手・金額だけ)。用途はアクセシブルネームで特定する。
const rowOf = (page: Page, purpose: string) => page.getByRole('list', { name: '割り勘の内訳一覧' }).getByRole('button', { name: purpose })
const detailOf = (page: Page) => page.getByRole('dialog', { name: '割り勘詳細' })

test.describe('F-04 割り勘・精算', () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`A が割り勘登録 → B が支払報告 → A が受領確認で精算済みになる（${viewport.width}px）`, async ({ browser, baseURL, consoleGuard }) => {
      const contextA = await browser.newContext({ baseURL, viewport, timezoneId: 'Asia/Tokyo' })
      const contextB = await browser.newContext({ baseURL, viewport, timezoneId: 'Asia/Tokyo' })
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      consoleGuard.watch(pageA)
      consoleGuard.watch(pageB)

      await setupUserWithHousehold(pageA, 'warikan_payer')
      const inviteCode = await getInviteCode(pageA)
      const userB = newUser('warikan_debtor')
      await register(pageB, userB)
      await joinHousehold(pageB, inviteCode)

      const purpose = '[E2E_TEST] 夕食の割り勘'
      await pageA.goto('/kakeibo')
      await addTransaction(pageA, '支出', 3000, purpose, { splitWith: userB.displayName, splitRatio: 50 })

      // A(立替者)側：請求対象として表示される
      await pageA.goto('/warikan')
      const rowA = rowOf(pageA, purpose)
      await expect(rowA).toContainText('1,500円')
      await expect(rowA).not.toContainText('未請求')
      await rowA.click()
      await expect(detailOf(pageA)).toContainText('未請求')
      await detailOf(pageA).getByRole('button', { name: '閉じる' }).click()
      await expect(pageA.getByRole('tab', { name: 'すべて' })).toHaveAttribute('aria-selected', 'true')

      // 世帯内・世帯外が混在しても初回表示で両方が見え、種別で絞り込める。
      const externalPurpose = '[E2E_TEST] 混在の世帯外割り勘'
      await pageA.goto('/kakeibo')
      await addExternalExpense(pageA, externalPurpose, 'e2euser_external_mixed')
      await pageA.getByRole('link', { name: /割り勘/ }).click()
      await expect(pageA.getByRole('tab', { name: 'すべて' })).toHaveAttribute('aria-selected', 'true')
      const externalRow = rowOf(pageA, externalPurpose)
      await expect(rowA).toBeVisible()
      await expect(externalRow).toBeVisible()
      await expectNoPageOverflow(pageA)
      await pageA.getByRole('tab', { name: '世帯内' }).click()
      await expect(rowA).toBeVisible()
      await expect(externalRow).toHaveCount(0)
      await pageA.getByRole('tab', { name: '世帯外' }).click()
      await expect(rowA).toHaveCount(0)
      await expect(externalRow).toBeVisible()
      await pageA.getByRole('tab', { name: 'すべて' }).click()
      await expect(rowA).toBeVisible()
      await expect(externalRow).toBeVisible()

      // B(負担者)側：支払を報告する
      await pageB.goto('/warikan')
      await rowOf(pageB, purpose).click()
      await detailOf(pageB).getByRole('button', { name: '支払う' }).click()
      await pageB.getByTestId('settlement-account-modal').getByRole('button', { name: '支払った' }).click()
      await expect(detailOf(pageB)).toContainText('受領確認待ち')

      // A 側：受領を確定すると精算済みになる
      await pageA.reload()
      await rowA.click()
      await detailOf(pageA).getByRole('button', { name: '受け取りました' }).click()
      await pageA.getByTestId('settlement-account-modal').getByRole('button', { name: '受け取りを確定' }).click()
      await expect(detailOf(pageA)).toContainText('精算済み')

      await contextA.close()
      await contextB.close()
    })
  }

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`1人世帯の世帯外登録が初回一覧に出る（${viewport.width}px）`, async ({ browser, baseURL, consoleGuard }) => {
      const context = await browser.newContext({ baseURL, viewport, timezoneId: 'Asia/Tokyo' })
      try {
        const page = await context.newPage()
        consoleGuard.watch(page)
        await setupUserWithHousehold(page, `warikan_external_${viewport.width}`)
        const purpose = '[E2E_TEST] 世帯外割り勘'
        const externalName = `e2euser_external_${viewport.width}`
        await page.goto('/kakeibo')
        await addExternalExpense(page, purpose, externalName)
        await page.getByRole('link', { name: /割り勘/ }).click()
        const row = rowOf(page, purpose)
        await expect(row).toContainText(externalName)
        await expect(row).toContainText('1,500円')
        await expect(page.getByRole('tab', { name: 'すべて' })).toHaveAttribute('aria-selected', 'true')
        await page.reload()
        await expect(row).toBeVisible()
        await expectNoPageOverflow(page)
        await screenshot(page, viewport.width)
        await page.getByRole('tab', { name: '世帯内' }).click()
        await expect(page.getByText('世帯内の割り勘の内訳はありません')).toBeVisible()
        await page.getByRole('tab', { name: '世帯外' }).click()
        await expect(row).toBeVisible()
        await row.click()
        const detail = detailOf(page)
        await expect(detail).toContainText('未請求')
        await expectNoPageOverflow(page)
        await screenshot(page, viewport.width, 'warikan-detail')
        await detail.getByRole('button', { name: '請求', exact: true }).click()
        await expect(detail).toContainText('請求中')
        await detail.getByRole('button', { name: '閉じる' }).click()
        await expect(page.getByRole('tab', { name: '世帯外' })).toHaveAttribute('aria-selected', 'true')
        if (viewport.width === 390) {
          await page.setViewportSize({ width: 320, height: 844 })
          await page.getByRole('tab', { name: 'すべて' }).click()
          await expectNoPageOverflow(page)
          await screenshot(page, 320)
        }
        // 狭い幅でも詳細モーダルから精算できる。
        await row.click()
        await expectNoPageOverflow(page)
        await detail.getByRole('button', { name: '精算済みにする' }).click()
        await page.getByTestId('settlement-account-modal').getByRole('button', { name: '精算済みにする' }).click()
        await expect(detail).toContainText('精算済み')
      } finally {
        await context.close()
      }
    })
  }
})
