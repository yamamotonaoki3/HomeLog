import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { createHousehold, getInviteCode, joinHousehold, register } from './support/flows'
import { newUser } from './support/test-data'

// 世帯設定(S-27)。情報を1枚のカードにまとめ、退出は下部に分ける(#501)。
for (const width of [1280, 390, 320]) {
  test(`世帯設定は長い名前でもはみ出さず、退出を確認つきの危険操作として分ける ${width}px (#501)`, async ({ page, browser, baseURL, context, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const owner = newUser(`household_owner_${width}`)
    const householdName = '[E2E_TEST] ' + '長い世帯名'.repeat(7)
    await register(page, owner)
    await createHousehold(page, householdName)
    const inviteCode = await getInviteCode(page)

    // 2人目は長い表示名で参加する。
    const memberContext = await browser.newContext({ baseURL })
    const memberPage = await memberContext.newPage()
    const member = { ...newUser(`household_member_${width}`), displayName: 'e2euser_' + '長い表示名'.repeat(8) }
    await register(memberPage, member)
    await joinHousehold(memberPage, inviteCode)
    await memberContext.close()

    await page.reload()
    const panel = page.getByTestId('household-settings-panel')
    await expect(panel.getByRole('heading', { level: 2, name: '世帯設定', exact: true })).toBeVisible()
    const info = panel.getByRole('region', { name: '世帯グループの情報', exact: true })
    await expect(info.getByText(householdName, { exact: true })).toBeVisible()
    await expect(info.getByRole('list', { name: 'メンバー', exact: true }).getByRole('listitem')).toHaveText([owner.displayName, member.displayName])
    await expect(info.getByText('2人', { exact: true })).toBeVisible()
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await noOverflow()
    expect(await info.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)

    const back = panel.getByRole('link', { name: '設定に戻る', exact: true })
    const copy = info.getByRole('button', { name: '招待コードをコピー', exact: true })
    const danger = panel.getByRole('region', { name: '世帯グループからの退出', exact: true })
    const leave = danger.getByRole('button', { name: '世帯グループから退出する', exact: true })
    for (const control of [back, copy, leave]) {
      const box = (await control.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    // 退出は情報のカードより下に離して置く。
    const [infoBox, dangerBox] = await Promise.all([info.boundingBox(), danger.boundingBox()])
    expect(dangerBox!.y).toBeGreaterThanOrEqual(infoBox!.y + infoBox!.height + 8)

    // コピーした内容は画面の招待コードと一致する(値そのものはログへ出さない)。
    await copy.click()
    await expect(info.getByRole('status')).toHaveText('招待コードをコピーしました')
    expect(await page.evaluate(() => navigator.clipboard.readText()) === inviteCode).toBe(true)
    expect(page.url()).not.toContain(inviteCode)

    const directory = process.env.SETTINGS_SHOTS_DIR
    if (directory) {
      await mkdir(directory, { recursive: true })
      // 招待コードは画面写真に残さない。
      await page.screenshot({ path: join(directory, `household-settings-${width}.png`), fullPage: true, mask: [page.getByTestId('household-invite-code')] })
    }

    // 確認ダイアログはキーボードで取り消せ、フォーカスが退出ボタンへ戻る。
    await leave.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '本当に退出しますか？', exact: true })
    const cancel = dialog.getByRole('button', { name: 'キャンセル', exact: true })
    const confirm = dialog.getByRole('button', { name: '退出する', exact: true })
    await expect(cancel).toBeFocused()
    await expect(dialog).toContainText('あなたが最後のメンバーの場合、世帯グループと共有データ（在庫・買い物リスト等）はすべて削除されます。')
    for (const control of [cancel, confirm]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const dialogBox = (await dialog.boundingBox())!
    expect(dialogBox.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Tab')
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(cancel).toBeFocused()
    if (directory) await page.screenshot({ path: join(directory, `household-leave-confirm-${width}.png`), mask: [page.getByTestId('household-invite-code')] })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(leave).toBeFocused()
    await expect(page).toHaveURL(/\/household\/settings$/)

    // 確定すると退出し、世帯の選択画面へ移る。
    await leave.click()
    await confirm.click()
    await expect(page).toHaveURL(/\/household$/)

    // 設定に戻る導線(退出していない2人目の画面で確かめる)。
    const secondContext = await browser.newContext({ baseURL, viewport: { width, height: 844 } })
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/login')
    await secondPage.getByLabel('メールアドレス').fill(member.email)
    await secondPage.locator('#login-password').fill(member.password)
    await secondPage.getByRole('button', { name: 'ログイン' }).click()
    await expect(secondPage).toHaveURL(/\/$/)
    await secondPage.goto('/household/settings')
    await expect(secondPage.getByRole('list', { name: 'メンバー', exact: true }).getByRole('listitem')).toHaveText([member.displayName])
    await secondPage.getByRole('link', { name: '設定に戻る', exact: true }).click()
    await expect(secondPage).toHaveURL(/\/settings$/)
    await secondContext.close()
  })
}
