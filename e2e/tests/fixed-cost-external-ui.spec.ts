import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold, getInviteCode, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

for (const width of [1280, 390, 320]) {
  test(`固定費の世帯外入力・混在編集・ID保持・名前差し替え ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    const memberContext = await browser.newContext({ baseURL })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `fixed_external_${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const apiCosts = async () => {
        const response = await page.request.get('/api/fixed-costs', { headers })
        expect(response.ok()).toBe(true)
        return response.json()
      }
      const press = async (locator: ReturnType<typeof page.getByRole>) => width < 400 ? locator.tap() : locator.click()
      const checkWidth = async (label?: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        for (const element of await page.locator('.fixed-cost-modal, .fixed-cost-modal form, .fixed-cost-modal fieldset, .fixed-cost-modal dd, .split-row').all()) {
          expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
          const box = (await element.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
        }
        if (label && process.env.FIXED_EXTERNAL_SCREENSHOT_DIR) {
          await mkdir(process.env.FIXED_EXTERNAL_SCREENSHOT_DIR, { recursive: true })
          await page.getByRole('dialog').evaluate((el) => { el.scrollTop = 0 })
          await page.screenshot({ path: join(process.env.FIXED_EXTERNAL_SCREENSHOT_DIR, `${label}-${width}.png`), fullPage: true })
          if (label === 'register-external' || label === 'edit-mixed') {
            const dialog = page.getByRole('dialog')
            const action = dialog.getByRole('button', { name: label === 'register-external' ? '登録' : '更新', exact: true })
            await action.scrollIntoViewIfNeeded()
            await expect(action).toBeInViewport()
            await page.screenshot({ path: join(process.env.FIXED_EXTERNAL_SCREENSHOT_DIR, `${label}-bottom-${width}.png`), fullPage: true })
          }
        }
      }
      const name = '[E2E_TEST]世帯外固定費'
      const externalA = '[E2E_TEST]' + '長'.repeat(40) // 50文字
      const externalB = '[E2E_TEST]' + 'A'.repeat(40)
      await page.goto('/fixed-costs')
      await press(page.getByRole('button', { name: '固定費を登録', exact: true }))
      const form = page.getByRole('dialog', { name: '固定費を登録' })
      await form.getByLabel('固定費名', { exact: true }).fill(name)
      await form.getByLabel('金額', { exact: true }).fill('9999999999')
      await form.getByLabel('割り勘する').check()
      await expect(form.getByLabel('割り勘の相手の種別')).toHaveValue('external')
      await form.getByLabel('世帯外の人の名前').fill(externalA)
      await press(form.getByRole('button', { name: '相手を追加' }))
      await form.getByLabel('世帯外の人の名前').nth(1).fill(externalB)
      await form.getByLabel('負担割合（％）').nth(0).fill('20')
      await form.getByLabel('負担割合（％）').nth(1).fill('30')
      await checkWidth('register-external')
      await press(form.getByRole('button', { name: '登録', exact: true }))
      await expect(form).toBeHidden()
      const created = (await apiCosts()).find((cost: { name: string }) => cost.name === name)
      expect(created.splits.map((split: { debtorExternalName: string }) => split.debtorExternalName)).toEqual([externalA, externalB])
      const ids = created.splits.map((split: { debtorExternalId: number }) => split.debtorExternalId)
      const witnessResponse = await page.request.post('/api/fixed-costs', { headers, data: { name: '[E2E_TEST]既存相手の参照', amount: 1000, paymentDay: 1, personal: true, splitInputType: 'ratio', splits: [{ debtorExternalId: ids[0], ratio: 50 }] } })
      expect(witnessResponse.status()).toBe(201)
      const witnessId = (await witnessResponse.json()).id
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      await press(row)
      const detail = page.getByRole('dialog', { name: '固定費詳細' })
      await expect(detail).toContainText(externalA)
      await expect(detail).toContainText(externalB)
      await expect(detail).toContainText('20% / 1999999999円')
      expect(await detail.evaluate((el) => el.scrollTop)).toBe(0)
      await checkWidth('detail-external')
      await page.keyboard.press('Tab')
      await expect(detail.getByRole('button', { name: '編集' })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(detail.getByRole('button', { name: '閉じる' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(row).toBeFocused()

      // 同世帯のメンバーを追加し、既存外部IDと混在させる。
      const invite = await getInviteCode(page)
      const other = await memberContext.newPage()
      consoleGuard.watch(other)
      const member = newUser(`fixed_external_member_${width}`)
      await register(other, member)
      await joinHousehold(other, invite)
      await page.goto('/fixed-costs')
      await press(row)
      await press(detail.getByRole('button', { name: '編集' }))
      const edit = page.getByRole('dialog', { name: '固定費を編集' })
      await expect(edit.getByLabel('世帯外の人の名前').nth(0)).toHaveValue(externalA)
      await expect(edit.getByLabel('世帯外の人の名前').nth(1)).toHaveValue(externalB)
      await press(edit.getByRole('button', { name: '相手を追加' }))
      await edit.getByLabel('世帯メンバー').selectOption({ label: member.displayName })
      await edit.getByRole('tab', { name: '金額入力', exact: true }).click()
      for (const [i, value] of ['200', '300', '400'].entries()) await edit.getByLabel('負担額（円）').nth(i).fill(value)
      await checkWidth('edit-mixed')
      await press(edit.getByRole('button', { name: '更新', exact: true }))
      await expect(detail).toContainText(member.displayName)
      let saved = (await apiCosts()).find((cost: { id: number }) => cost.id === created.id)
      expect(saved.splits.slice(0, 2).map((split: { debtorExternalId: number }) => split.debtorExternalId)).toEqual(ids)
      await page.reload()
      await press(row)
      await expect(detail).toContainText('200円')
      await checkWidth('detail-mixed')
      await other.goto('/fixed-costs')
      await other.getByRole('button', { name: `${name}の詳細`, exact: true }).click()
      const privateDetail = other.getByRole('dialog', { name: '固定費詳細' })
      await expect(privateDetail.getByText('非公開', { exact: true })).toHaveCount(2)
      await expect(privateDetail).not.toContainText(externalA)
      await expect(privateDetail).not.toContainText(externalB)
      await expect(privateDetail.getByRole('button', { name: '編集' })).toHaveCount(0)

      await press(detail.getByRole('button', { name: '編集' }))
      await edit.getByLabel('世帯外の人の名前').nth(0).fill('[E2E_TEST]差し替え相手')
      await press(edit.getByRole('button', { name: 'キャンセル' }))
      await expect(detail).toContainText(externalA)
      await press(detail.getByRole('button', { name: '編集' }))
      await edit.getByLabel('世帯外の人の名前').nth(0).fill('[E2E_TEST]差し替え相手')
      await edit.locator('.split-row').nth(1).getByRole('button', { name: '削除' }).click()
      await press(edit.getByRole('button', { name: '更新', exact: true }))
      await expect(detail).toContainText('[E2E_TEST]差し替え相手')
      saved = (await apiCosts()).find((cost: { id: number }) => cost.id === created.id)
      expect(saved.splits).toHaveLength(2)
      expect(saved.splits[0].debtorExternalId).not.toBe(ids[0])
      const witness = (await apiCosts()).find((cost: { id: number }) => cost.id === witnessId)
      expect(witness.splits[0]).toMatchObject({ debtorExternalId: ids[0], debtorExternalName: externalA })
      await press(detail.getByRole('button', { name: '編集' }))
      await edit.getByLabel('割り勘する').uncheck()
      await press(edit.getByRole('button', { name: '更新', exact: true }))
      await expect(detail.getByText('なし', { exact: true })).toHaveCount(2)
      expect((await apiCosts()).find((cost: { id: number }) => cost.id === created.id).splits).toEqual([])
    } finally { await context.close(); await memberContext.close() }
  })
}
