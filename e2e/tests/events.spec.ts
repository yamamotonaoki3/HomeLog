import { openAccountMenu } from './support/flows'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold, getInviteCode, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

async function checkEventRow(page: Page, row: Locator, width: number, dialogName: string, initialFocusName?: string) {
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
  const initial = editing ? dialog.getByLabel('イベント名', { exact: true }) : initialFocusName ? dialog.getByRole('button', { name: initialFocusName, exact: true }) : close
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
  await row.press('Tab'); await page.keyboard.press('Shift+Tab'); await expect(row).toBeFocused()
  const focus = await row.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, outline: getComputedStyle(el).outlineStyle }))
  expect(focus.outline).toBe('solid')
  if (width === 1280) {
    await row.hover()
    expect(await row.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(focus.background)
  }
  for (let i = 0; i < 3; i++) {
    const cell = row.locator(['.event-date-block', '.event-row-title', '.event-row-meta'][i])
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

async function measureEditorTargets(dialog: Locator) {
  const invalid = await dialog.locator('button:visible,label:has(input[type=checkbox]):visible,label:has(input[type=radio]):visible').evaluateAll(elements => elements.flatMap(el => {
    const rect = el.getBoundingClientRect()
    return rect.width < 44 || rect.height < 44 ? [{ name: el.getAttribute('aria-label') ?? el.textContent?.trim(), width: rect.width, height: rect.height }] : []
  }))
  expect.soft(invalid, 'イベント主要操作・labelの44px実測').toEqual([])
}

async function checkEditorLayout(page: Page, dialog: Locator) {
  const body = dialog.locator('.event-editor-body')
  const actions = dialog.locator('.event-editor-actions')
  for (const control of await dialog.locator('input:not([type=checkbox]):not([type=radio]):visible,select:visible,textarea:visible').all()) {
    expect(await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  }
  await measureEditorTargets(dialog)
  if (page.viewportSize()!.width <= 600) {
    const before = (await actions.boundingBox())!
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    const after = (await actions.boundingBox())!
    expect(after.y).toBeCloseTo(before.y, 0)
    expect(after.y + after.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    expect(after.y).toBeGreaterThanOrEqual(0)
  } else await actions.scrollIntoViewIfNeeded()
  await dialog.getByLabel('イベント名', { exact: true }).focus()
  const count = await dialog.locator('button,input,select,textarea,a[href],[tabindex]').evaluateAll(elements => elements.filter(el => (el as HTMLElement).tabIndex >= 0 && !el.matches(':disabled,input[type="hidden"]') && el.getClientRects().length > 0).length)
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < count; index++) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
      const rect = await page.evaluate(() => { const box = document.activeElement!.getBoundingClientRect(); return { top: box.top, bottom: box.bottom } })
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
    }
    await expect(dialog.getByLabel('イベント名', { exact: true })).toBeFocused()
  }
  await fits(page)
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('.event-modal').all()) {
    expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px イベント統合モーダル`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 500 })
    test('日付ブロックと名称・時刻・繰返を情報欠落なく表示する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'event_datetime' + width)
      await page.goto('/events')
      const registerButton = page.getByRole('button', { name: 'イベントを登録', exact: true })
      await expect(registerButton).toBeVisible()
      const registerStyle = await registerButton.evaluate(el => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return { background: style.backgroundColor, color: style.color, width: rect.width, height: rect.height }
      })
      expect(registerStyle.background).toBe('rgb(0, 0, 0)')
      expect(registerStyle.color).toBe('rgb(255, 255, 255)')
      expect(registerStyle.width).toBeGreaterThanOrEqual(44)
      expect(registerStyle.height).toBeGreaterThanOrEqual(44)
      await registerButton.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(registerButton).toBeFocused()
      expect(await registerButton.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
      let dateColumnX: number | undefined
      for (const [index, label] of ['終日', '09:00〜', '09:00〜12:00'].entries()) {
        const name = `[E2E_TEST] 日時${index}`
        await page.getByRole('button', { name: 'イベントを登録' }).click()
        await page.getByLabel('イベント名').fill(name)
        await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
        if (index > 0) {
          await page.getByLabel('終日', { exact: true }).uncheck()
          await page.getByLabel('開始時刻').fill('09:00')
          if (index === 2) await page.getByLabel('終了時刻（任意）').fill('12:00')
        }
        await page.getByRole('button', { name: '登録', exact: true }).click()
        const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
        const date = row.locator('.event-date-block time')
        const year = date.getByText('2030年', { exact: true })
        const monthDay = date.getByText('1/15', { exact: true })
        const title = row.locator('.event-row-title')
        const time = row.locator('.event-row-meta').getByText(label, { exact: true })
        await expect(date).toHaveAttribute('datetime', '2030-01-15')
        await expect(year).toBeVisible()
        await expect(monthDay).toBeVisible()
        await expect(time).toBeVisible()
        await expect(row).toHaveAccessibleDescription('2030-01-15 ' + label + ' 単発')
        const dateBox = (await date.boundingBox())!
        const titleBox = (await title.boundingBox())!
        const timeBox = (await time.boundingBox())!
        expect(titleBox.x).toBeGreaterThanOrEqual(dateBox.x + dateBox.width)
        expect(timeBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height)
        if (dateColumnX !== undefined) expect(dateBox.x).toBeCloseTo(dateColumnX, 0)
        dateColumnX = dateBox.x
        for (const element of [year, monthDay, time]) {
          const line = await element.evaluate(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const rects = [...range.getClientRects()]
            return { text: el.textContent, font: parseFloat(getComputedStyle(el).fontSize), tops: rects.map(rect => rect.top) }
          })
          expect(line.tops.length, line.text ?? '').toBeGreaterThan(0)
          expect(Math.max(...line.tops) - Math.min(...line.tops), '単一行: ' + JSON.stringify(line)).toBeLessThan(line.font / 2)
        }
        expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      }

      // 一覧改善は既存APIの順序・全情報・通知値を変えない。
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: 'Bearer ' + token }
      const fixtureNames = ['[E2E_TEST] 同名別年', '[E2E_TEST] 同名別年', '[E2E_TEST]' + '長'.repeat(40), '[E2E_TEST] 月末', '[E2E_TEST] 閏日']
      const fixtureDates = ['2029-01-15', '2031-01-15', '2028-12-31', '2028-01-31', '2028-02-29']
      const recurrences = ['none', 'daily', 'weekly', 'monthly', 'yearly']
      for (const [index, recurrenceType] of recurrences.entries()) {
        const response = await page.request.post('/api/events', { headers, data: { name: fixtureNames[index], eventDate: fixtureDates[index], isAllDay: true, recurrenceType, notifyEnabled: true, personal: false } })
        expect(response.status()).toBe(201)
      }
      for (let index = 0; index < 12; index++) {
        const response = await page.request.post('/api/events', { headers, data: { name: '[E2E_TEST] 多数' + index, eventDate: '2030-02-01', personal: false } })
        expect(response.status()).toBe(201)
      }
      const beforeResponse = await page.request.get('/api/events', { headers })
      expect(beforeResponse.ok()).toBe(true)
      const before = await beforeResponse.json() as { id: number; name: string; eventDate: string; recurrenceType: string; notifyEnabled: boolean }[]
      const mutations: string[] = []
      page.on('request', request => { if (/\/api\/events(?:\/\d+)?(?:\?|$)/.test(new URL(request.url()).pathname) && ['POST', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.method()) })
      await page.reload()
      const allRows = page.getByTestId('events-panel').getByRole('button', { name: /の詳細$/ })
      await expect(allRows).toHaveCount(before.length)
      await expect.poll(() => allRows.evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')))).toEqual(before.map(event => event.name + 'の詳細'))
      expect(await allRows.evaluateAll(elements => elements.flatMap(el => {
        const box = el.getBoundingClientRect()
        const title = el.querySelector('.event-row-title') as HTMLElement
        const range = document.createRange()
        range.selectNodeContents(title)
        const textBox = range.getBoundingClientRect()
        const titleBox = title.getBoundingClientRect()
        return box.height < 44 || el.scrollWidth > el.clientWidth || title.scrollWidth > title.clientWidth || textBox.bottom > titleBox.bottom + 1 ? [el.getAttribute('aria-label')] : []
      }))).toEqual([])
      const recurrenceLabels = ['単発', '毎日', '毎週', '毎月', '毎年']
      for (const [index, event] of before.slice(3, 8).entries()) {
        const row = allRows.nth(index + 3)
        await expect(row).toHaveAccessibleDescription(new RegExp(fixtureDates[index]))
        await expect(row).toHaveAccessibleDescription(new RegExp(recurrenceLabels[index]))
        await expect(row.locator('time')).toHaveAttribute('datetime', event.eventDate)
        await row.click()
        const editor = page.getByRole('dialog', { name: 'イベントを編集' })
        await expect(editor.getByLabel('イベント名', { exact: true })).toHaveValue(event.name)
        await expect(editor.getByLabel('日付', { exact: true })).toHaveValue(event.eventDate)
        const notification = editor.getByLabel('通知する', { exact: true })
        if (event.recurrenceType === 'none') {
          await expect(notification).not.toBeChecked()
          await expect(notification).toBeDisabled()
        } else await expect(notification).toBeChecked()
        await editor.getByRole('button', { name: 'キャンセル', exact: true }).click()
        await expect(row).toBeFocused()
      }
      const afterResponse = await page.request.get('/api/events', { headers })
      expect(afterResponse.ok()).toBe(true)
      expect(await afterResponse.json()).toEqual(before)
      expect(mutations).toEqual([])
      await fits(page)
      const shots = process.env.ISSUE_341_SHOTS_DIR
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: join(shots, `event-datetime-${width}.png`), fullPage: true })
      }
    })


    test('登録編集は公開範囲と通知・詳細値を保ち固定操作で同じpayloadを保存する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'event_form426_' + width)
      await page.goto('/events')
      const add = page.getByRole('button', { name: 'イベントを登録', exact: true })
      await add.click()
      let dialog = page.getByRole('dialog', { name: 'イベントを登録', exact: true })
      await expect(dialog.getByRole('radio', { name: '世帯共有', exact: true })).toBeVisible()
      await expect(dialog.getByRole('radio', { name: '個人', exact: true })).toBeVisible()
      const name = '[E2E_TEST] 通知保存426_' + width
      await dialog.getByLabel('イベント名', { exact: true }).fill(name)
      await dialog.getByLabel('日付', { exact: true }).fill('2031-03-31')
      await dialog.getByLabel('終日', { exact: true }).uncheck()
      const start = dialog.getByLabel('開始時刻', { exact: true })
      const end = dialog.getByLabel('終了時刻（任意）', { exact: true })
      await start.fill('08:00')
      await end.fill('09:30')
      const startBox = (await start.boundingBox())!
      const endBox = (await end.boundingBox())!
      expect(Math.abs(startBox.y - endBox.y)).toBeLessThan(1)
      expect(endBox.x).toBeGreaterThanOrEqual(startBox.x + startBox.width)
      const recurrence = dialog.getByLabel('繰り返し', { exact: true })
      const notification = dialog.getByLabel('通知する', { exact: true })
      await expect(recurrence).toHaveValue('none')
      await expect(notification).not.toBeChecked()
      await expect(notification).toBeDisabled()
      await recurrence.selectOption('monthly')
      await expect(notification).not.toBeChecked()
      await notification.check()
      await recurrence.selectOption('none')
      await expect(notification).not.toBeChecked()
      await expect(notification).toBeDisabled()
      await recurrence.selectOption('monthly')
      await expect(notification).not.toBeChecked()
      await notification.check()
      const extras = dialog.getByRole('button', { name: /^その他の設定/ })
      await expect(dialog.getByLabel('デフォルト金額（任意）', { exact: true })).toBeHidden()
      await extras.click()
      await dialog.getByLabel('デフォルト金額（任意）', { exact: true }).fill('1300')
      await dialog.getByLabel('トップ画面のイベント別支出サマリーに表示する', { exact: true }).uncheck()
      await extras.click()
      await expect(extras).toContainText(/1,?300/)
      await extras.click()
      await expect(dialog.getByLabel('デフォルト金額（任意）', { exact: true })).toHaveValue('1300')
      await expect(dialog.getByLabel('トップ画面のイベント別支出サマリーに表示する', { exact: true })).not.toBeChecked()
      await checkEditorLayout(page, dialog)
      const post = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/events')
      await dialog.getByRole('button', { name: '登録', exact: true }).click()
      expect((await post).postDataJSON()).toEqual({ name, eventDate: '2031-03-31', isAllDay: false, startTime: '08:00', endTime: '09:30', recurrenceType: 'monthly', notifyEnabled: true, defaultAmount: 1300, showOnDashboard: false, personal: false })
      await expect(dialog).toBeHidden()
      const createdResponse = await (await post).response()
      expect(createdResponse?.status()).toBe(201)
      const createdEvent = await createdResponse!.json() as { id: number }
      consoleGuard.allow({ url: new RegExp('/api/events/' + createdEvent.id + '/summary\\?period=year$'), message: /404 \(Not Found\)/ })
      const row = page.getByRole('button', { name: name + 'の詳細', exact: true })
      await expect(row).toBeVisible()
      await row.click()
      dialog = page.getByRole('dialog', { name: 'イベントを編集', exact: true })
      await expect(dialog).toContainText('集計対象外')
      await dialog.getByLabel('繰り返し', { exact: true }).selectOption('none')
      const patch = page.waitForRequest(request => request.method() === 'PATCH' && /\/api\/events\/\d+$/.test(new URL(request.url()).pathname))
      await dialog.getByRole('button', { name: '更新', exact: true }).click()
      expect((await patch).postDataJSON()).toEqual({ name, eventDate: '2031-03-31', isAllDay: false, startTime: '08:00', endTime: '09:30', recurrenceType: 'none', notifyEnabled: false, defaultAmount: 1300, showOnDashboard: false, personal: false })
      await expect(dialog).toBeHidden()
      const normalizedToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const normalizedResponse = await page.request.get('/api/events', { headers: { Authorization: 'Bearer ' + normalizedToken } })
      expect(normalizedResponse.ok()).toBe(true)
      expect(await normalizedResponse.json()).toEqual([expect.objectContaining({ id: createdEvent.id, recurrenceType: 'none', notifyEnabled: false })])
      await row.click()
      dialog = page.getByRole('dialog', { name: 'イベントを編集', exact: true })
      await expect(dialog.getByLabel('通知する', { exact: true })).not.toBeChecked()
      await expect(dialog.getByLabel('通知する', { exact: true })).toBeDisabled()
      await dialog.getByLabel('繰り返し', { exact: true }).selectOption('monthly')
      await expect(dialog.getByLabel('通知する', { exact: true })).not.toBeChecked()
      await dialog.getByLabel('通知する', { exact: true }).check()
      const manualPatch = page.waitForRequest(request => request.method() === 'PATCH' && /\/api\/events\/\d+$/.test(new URL(request.url()).pathname))
      await dialog.getByRole('button', { name: '更新', exact: true }).click()
      expect((await manualPatch).postDataJSON()).toEqual({ name, eventDate: '2031-03-31', isAllDay: false, startTime: '08:00', endTime: '09:30', recurrenceType: 'monthly', notifyEnabled: true, defaultAmount: 1300, showOnDashboard: false, personal: false })
      await expect(dialog).toBeHidden()
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const response = await page.request.get('/api/events', { headers: { Authorization: 'Bearer ' + token } })
      expect(response.ok()).toBe(true)
      expect(await response.json()).toEqual([expect.objectContaining({ name, recurrenceType: 'monthly', notifyEnabled: true, defaultAmount: 1300, showOnDashboard: false })])
    })

    test('編集・集計・削除確認を同じモーダルで操作する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      consoleGuard.allow({ url: /\/api\/events\/\d+\/summary/, message: /404/ })
      await setupUserWithHousehold(page, 'event_unified' + width)
      await page.goto('/events')
      const name = '[E2E_TEST]' + 'A'.repeat(40)
      await page.getByRole('button', { name: 'イベントを登録' }).click()
      await page.getByLabel('イベント名').fill(name)
      await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
      await page.getByLabel('終日', { exact: true }).uncheck()
      await page.getByLabel('開始時刻').fill('20:00')
      await page.getByLabel('終了時刻（任意）').fill('21:00')
      await page.getByLabel('繰り返し', { exact: true }).selectOption('daily')
      await page.getByLabel('通知する', { exact: true }).check()
      await page.getByRole('button', { name: /^その他の設定/ }).click()
      await page.getByLabel('デフォルト金額（任意）').fill('1200')
      await page.getByRole('button', { name: '登録', exact: true }).click()
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await expect(row).toBeVisible()
      await checkEventRow(page, row, width, 'イベントを編集')
      await row.click()
      const modal = page.getByRole('dialog', { name: 'イベントを編集' })
      await expect(modal.getByLabel('イベント名')).toBeFocused()
      await measureEditorTargets(modal)
      const shots = process.env.ISSUE_246_SHOTS_DIR
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: join(shots, `event-edit-top-${width}.png`), fullPage: true })
      }
      await expect(modal.getByLabel('通知する', { exact: true })).toBeChecked()
      await expect(modal.getByLabel('デフォルト金額（任意）')).toHaveValue('1200')
      await expect(modal).toContainText('支出合計：0円')
      await modal.getByLabel('イベント名').fill('[E2E_TEST] 編集済み')
      await modal.getByLabel('集計対象期間').selectOption('month')
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      await modal.getByRole('button', { name: name + 'を削除', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(modal.getByRole('button', { name: '削除をやめる' })).toBeFocused()
      await measureEditorTargets(modal)
      await fits(page)
      if (shots) await page.screenshot({ path: join(shots, `event-edit-delete-${width}.png`), fullPage: true })
      await modal.getByRole('button', { name: '削除をやめる' }).click()
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      await modal.getByRole('button', { name: '更新', exact: true }).click()
      await expect(modal).toBeHidden()
      const updatedRow = page.getByRole('button', { name: '[E2E_TEST] 編集済みの詳細' })
      await expect(updatedRow).toBeFocused()
      await page.reload()
      await updatedRow.click()
      await expect(modal.getByLabel('イベント名')).toHaveValue('[E2E_TEST] 編集済み')
      const editingExtras = modal.getByRole('button', { name: /^その他の設定/ })
      if (await editingExtras.getAttribute('aria-expanded') !== 'true') await editingExtras.click()
      await modal.getByLabel('トップ画面のイベント別支出サマリーに表示する').uncheck()
      await modal.getByRole('button', { name: '更新', exact: true }).click()
      await expect(modal).toBeHidden()
      await updatedRow.click()
      await expect(modal).toContainText('集計対象外')
      await fits(page)
      await modal.getByRole('button', { name: '[E2E_TEST] 編集済みを削除', exact: true }).click()
      await modal.getByRole('button', { name: '削除する', exact: true }).click()
      await expect(page.getByTestId('events-panel')).toContainText('イベントはありません')
      await expect(page.getByRole('button', { name: 'イベントを登録' })).toBeFocused()
    })
  })
}

for (const width of [1280, 390, 320]) {
  test(width + 'px 共有イベントは別メンバーが詳細を閲覧でき変更操作は表示されない', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'event_owner')
    const code = await getInviteCode(page)
    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill('[E2E_TEST] 共有イベント')
    await page.getByLabel('日付', { exact: true }).fill('2030-01-15')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByRole('button', { name: '[E2E_TEST] 共有イベントの詳細', exact: true })).toBeVisible()
    const ownerToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    const privateResponse = await page.request.post('/api/events', { headers: { Authorization: 'Bearer ' + ownerToken }, data: { name: '[E2E_TEST] 他者非公開イベント', eventDate: '2030-01-16', personal: true } })
    expect(privateResponse.status()).toBe(201)
    await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
    await register(page, newUser('event_member'))
    await joinHousehold(page, code)
    await page.goto('/events')
    await expect(page.getByRole('button', { name: '[E2E_TEST] 共有イベントの詳細', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '[E2E_TEST] 他者非公開イベントの詳細', exact: true })).toHaveCount(0)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    const row = page.getByRole('button', { name: '[E2E_TEST] 共有イベントの詳細', exact: true })
    await row.click()
    const detail = page.getByRole('dialog', { name: 'イベント詳細' })
    await expect(detail).toContainText('世帯共有')
    await expect(detail).toContainText('表示する')
    await expect(detail.getByRole('button', { name: /編集|削除|表示する|表示しない/ })).toHaveCount(0)
    const close = detail.getByRole('button', { name: '閉じる', exact: true })
    await expect(close).toBeFocused()
    await close.scrollIntoViewIfNeeded()
    const closeBox = await close.boundingBox()
    expect(closeBox!.width).toBeGreaterThanOrEqual(44)
    expect(closeBox!.height).toBeGreaterThanOrEqual(44)
    const readonlyShots = process.env.ISSUE_246_SHOTS_DIR
    if (readonlyShots) { await mkdir(readonlyShots, { recursive: true }); await page.screenshot({ path: join(readonlyShots, 'readonly-close-' + width + '.png') }) }
    await close.click()
    await expect(detail).toBeHidden()
    await expect(row).toBeFocused()
  })
}
