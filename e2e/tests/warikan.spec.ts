import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { addTransaction, getInviteCode, joinHousehold, register, setupUserWithHousehold } from './support/flows'
import { newUser } from './support/test-data'

async function addExternalExpense(page: Page, purpose: string, externalName: string) {
  await page.getByRole('button', { name: '登録', exact: true }).first().click()
  const modal = page.getByTestId('transaction-modal')
  await modal.getByLabel('金額').fill('3000')
  await modal.getByLabel('使用用途（任意）').fill(purpose)
  const extras = modal.getByRole('button', { name: 'その他の設定', exact: true })
  if (await extras.getAttribute('aria-expanded') !== 'true') await extras.click()
  await modal.getByLabel('割り勘する').check()
  await modal.getByLabel('割り勘の相手の種別').selectOption('external')
  const externalInput = modal.getByLabel('世帯外の人の名前')
  await expect(externalInput).toHaveAttribute('aria-invalid', 'true')
  await expect(externalInput).toHaveAccessibleDescription('割り勘の相手(世帯外の人)の名前を入力してください')
  await externalInput.fill(externalName)
  await expect(modal.getByLabel('負担割合（％）')).toHaveValue('50')
  await expect(modal.getByLabel('相手1の負担', { exact: true })).toHaveText('1,500円（50%）')
  await expect(modal.getByText('あなたの負担: 1,500円（50%）', { exact: true })).toBeVisible()
  await extras.click()
  await expect(externalInput).toBeHidden()
  await extras.click()
  await expect(externalInput).toHaveValue(externalName)
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
  const split = list.find((item: { expenseId: number }) => item.expenseId === created.id)
  expect(split).toBeTruthy()
  return split as { id: number }
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

async function checkDialog(page: Page, dialog: Locator, initial: Locator) {
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(initial).toBeFocused()
  await expect(initial).toBeInViewport()
  expect(await dialog.evaluate(el => el.scrollTop)).toBe(0)
  if (await dialog.evaluate(el => el.classList.contains('warikan-comments-modal'))) await screenshot(page, page.viewportSize()!.width, 'warikan-comments-initial')
  for (const control of await dialog.locator('input,select,textarea').all()) {
    expect(await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  }
  for (const button of await dialog.getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  const count = await dialog.locator('button,input,select,textarea,a[href],[tabindex]').evaluateAll(elements => elements.filter(el => (el as HTMLElement).tabIndex >= 0 && !el.matches(':disabled,input[type="hidden"]') && el.getClientRects().length > 0).length)
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < count; index++) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
      const rect = await page.evaluate(() => { const box = document.activeElement!.getBoundingClientRect(); return { top: box.top, bottom: box.bottom } })
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
    }
    await expect(initial).toBeFocused()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}
async function settlementCancel(page: Page, trigger: Locator) {
  await trigger.click()
  const child = page.getByTestId('settlement-account-modal')
  await expect(page.getByTestId('warikan-detail-modal')).toBeHidden()
  await checkDialog(page, child, child.locator('#settlement-account'))
  await page.keyboard.press('Escape')
  await expect(child).toBeHidden()
  await expect(detailOf(page)).toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await child.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(detailOf(page)).toBeVisible()
  await expect(trigger).toBeFocused()
}

// 一覧の用途を含むアクセシブル名から対象を特定する。

const rowOf = (page: Page, purpose: string) => page.getByRole('list', { name: '割り勘の内訳一覧' }).getByRole('button', { name: purpose })
const detailOf = (page: Page) => page.getByRole('dialog', { name: '割り勘詳細' })

test.describe('F-04 割り勘・精算', () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
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
      await expect(rowA).toContainText('未請求')
      await rowA.click()
      await expect(detailOf(pageA)).toContainText('未請求')
      await detailOf(pageA).getByRole('button', { name: '閉じる', exact: true }).click()
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
      await expect(detailOf(pageB).getByRole('button', { name: /の割り勘を削除$/ })).toHaveCount(0)
      await settlementCancel(pageB, detailOf(pageB).getByRole('button', { name: '支払う', exact: true }))
      await detailOf(pageB).getByRole('button', { name: '支払う', exact: true }).click()
      const paidRequest = pageB.waitForRequest(request => request.method() === 'PATCH' && /\/api\/expense-splits\/\d+\/mark-paid$/.test(new URL(request.url()).pathname))
      await pageB.getByTestId('settlement-account-modal').getByRole('button', { name: '支払った', exact: true }).click()
      expect((await paidRequest).postDataJSON()).toEqual({ accountId: null })
      await expect(detailOf(pageB)).toContainText('受領確認待ち')

      // A 側：受領を確定すると精算済みになる
      await pageA.reload()
      await rowA.click()
      await settlementCancel(pageA, detailOf(pageA).getByRole('button', { name: '受け取りました', exact: true }))
      await detailOf(pageA).getByRole('button', { name: '受け取りました', exact: true }).click()
      const receivedRequest = pageA.waitForRequest(request => request.method() === 'PATCH' && /\/api\/expense-splits\/\d+\/confirm-receipt$/.test(new URL(request.url()).pathname))
      await pageA.getByTestId('settlement-account-modal').getByRole('button', { name: '受け取りを確定', exact: true }).click()
      expect((await receivedRequest).postDataJSON()).toEqual({ accountId: null })
      await expect(detailOf(pageA)).toContainText('精算済み')
      await expect(detailOf(pageA).getByRole('button', { name: /の割り勘を削除$/ })).toHaveCount(0)
      await pageA.keyboard.press('Escape')
      await expect(rowA).toBeFocused()

      await contextA.close()
      await contextB.close()
    })
  }

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    test(`1人世帯の世帯外登録が初回一覧に出る（${viewport.width}px）`, async ({ browser, baseURL, consoleGuard }) => {
      const context = await browser.newContext({ baseURL, viewport, timezoneId: 'Asia/Tokyo' })
      try {
        const page = await context.newPage()
        consoleGuard.watch(page)
        await setupUserWithHousehold(page, `warikan_external_${viewport.width}`)
        const purpose = '[E2E_TEST] ' + '世帯外の長い用途'.repeat(8)
        const externalName = 'e2euser_' + '長い相手名'.repeat(8)
        await page.goto('/kakeibo')
        const split = await addExternalExpense(page, purpose, externalName)
        const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
        const headers = { Authorization: `Bearer ${token}` }
        const accountResponse = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 精算口座', type: 'bank', balance: 10000 } })
        expect(accountResponse.status()).toBe(201)
        const account = await accountResponse.json()
        for (let index = 0; index < 5; index++) {
          const response = await page.request.post('/api/expense-splits/' + split.id + '/comments', { headers, data: { body: ('[E2E_TEST] ' + index + '\n' + '長文コメント\n'.repeat(70)).slice(0, 500) } })
          expect(response.status()).toBe(201)
        }
        const balance = async () => (await (await page.request.get('/api/accounts', { headers })).json()).find((item: { id: number }) => item.id === account.id).balance
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
        const commentTrigger = detail.getByRole('button', { name: 'コメント(5)', exact: true })
        await commentTrigger.click()
        const comments = page.getByRole('dialog', { name: 'コメント', exact: true })
        await expect(page.getByTestId('warikan-detail-modal')).toBeHidden()
        await checkDialog(page, comments, comments.getByRole('button', { name: 'コメントを閉じる', exact: true }))
        await screenshot(page, viewport.width, 'warikan-comments')
        await page.keyboard.press('Escape')
        await expect(comments).toBeHidden()
        await expect(detail).toBeVisible()
        await expect(commentTrigger).toBeFocused()
        await commentTrigger.click()
        const body = '[E2E_TEST] UIコメント'
        await comments.getByLabel('コメントを投稿').fill(body)
        const posted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/expense-splits/' + split.id + '/comments')
        await comments.getByRole('button', { name: '投稿', exact: true }).click()
        expect((await posted).status()).toBe(201)
        await expect(comments).toContainText(body)
        await comments.getByRole('button', { name: '閉じる', exact: true }).click()
        await expect(detail.getByRole('button', { name: 'コメント(6)', exact: true })).toBeFocused()
        await detail.getByRole('button', { name: '請求', exact: true }).click()
        await expect(detail).toContainText('請求中')
        await detail.getByRole('button', { name: '閉じる', exact: true }).click()
        await expect(page.getByRole('tab', { name: '世帯外' })).toHaveAttribute('aria-selected', 'true')
        // 狭い幅でも詳細モーダルから精算できる。
        await row.click()
        await expectNoPageOverflow(page)
        const settleTrigger = detail.getByRole('button', { name: '精算済みにする', exact: true })
        await settlementCancel(page, settleTrigger)
        await settleTrigger.click()
        const settlement = page.getByTestId('settlement-account-modal')
        await settlement.getByLabel('口座（任意）').selectOption(String(account.id))
        const settled = page.waitForRequest(request => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/expense-splits/' + split.id + '/settle-self')
        await settlement.getByRole('button', { name: '精算済みにする', exact: true }).click()
        expect((await settled).postDataJSON()).toEqual({ accountId: account.id })
        await expect(detail).toContainText('精算済み')
        // 世帯外の精算済みは削除できる(#302)。
        expect(await balance()).toBe(11500)
        const incomes = await (await page.request.get('/api/incomes', { headers })).json()
        expect(incomes).toEqual([expect.objectContaining({ amount: 1500, accountId: account.id })])
        const trash = detail.getByRole('button', { name: purpose + 'の割り勘を削除', exact: true })
        expect((await trash.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await trash.click()
        const confirm = page.getByRole('dialog', { name: '割り勘の内訳を削除しますか？', exact: true })
        await expect(page.getByTestId('warikan-detail-modal')).toBeHidden()
        await checkDialog(page, confirm, confirm.getByRole('button', { name: 'キャンセル', exact: true }))
        await page.keyboard.press('Escape')
        await expect(detail).toBeVisible()
        await expect(trash).toBeFocused()
        await expect(page.getByRole('tab', { name: '世帯外', exact: true })).toHaveAttribute('aria-selected', 'true')
        expect(await balance()).toBe(11500)
        await trash.click()
        await expect(confirm).toContainText('口座の残高を元に戻します')
        await expectNoPageOverflow(page)
        await screenshot(page, viewport.width, 'warikan-settled-delete')
        await page.getByRole('button', { name: '削除する' }).click()
        await expect(page.getByText('割り勘の内訳を削除しました', { exact: true })).toBeVisible()
        await expect(row).toHaveCount(0)
        await expect(page.getByRole('tab', { name: '世帯外', exact: true })).toBeFocused()
        expect(await balance()).toBe(10000)
        expect(await (await page.request.get('/api/incomes', { headers })).json()).toHaveLength(0)
        expect(await (await page.request.get('/api/expenses', { headers })).json()).toHaveLength(1)
      } finally {
        await context.close()
      }
    })
  }
})
