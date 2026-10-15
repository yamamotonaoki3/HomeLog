import { test, expect } from './console-guard'
import { setupUserWithHousehold, getInviteCode, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

for (const width of [1280, 390, 320]) {
  test(`fixed cost external API contract ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    const otherContext = await browser.newContext({ baseURL })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `fixed_external_${width}`)
      const invite = await getInviteCode(page)
      const memberPage = await otherContext.newPage()
      consoleGuard.watch(memberPage)
      await register(memberPage, newUser(`fixed_member_${width}`))
      await joinHousehold(memberPage, invite)
      const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
      const memberHeaders = { Authorization: `Bearer ${await memberPage.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
      const me = await (await page.request.get('/api/households/me', { headers })).json()
      const members = me.members
      const memberId = members.find((m: { userId: number; displayName: string }) => m.displayName.includes(`fixed_member_${width}`)).userId
      const data = { name: '[E2E_TEST] mixed fixed cost', amount: 1001, paymentDay: 1, personal: false, splitInputType: 'ratio', splits: [{ debtorUserId: memberId, ratio: 25 }, { debtorExternalName: ' e2euser_friend ', ratio: 25 }] }
      const created = await page.request.post('/api/fixed-costs', { headers, data })
      expect(created.status()).toBe(201)
      const body = await created.json()
      expect(body.splits).toEqual([
        { debtorUserId: memberId, debtorExternalId: null, debtorExternalName: null, splitRatio: 25, amountDue: 250 },
        { debtorUserId: null, debtorExternalId: expect.any(Number), debtorExternalName: 'e2euser_friend', splitRatio: 25, amountDue: 250 },
      ])
      const externalId = body.splits[1].debtorExternalId
      const updated = await page.request.patch(`/api/fixed-costs/${body.id}`, { headers, data: { ...data, splitInputType: 'amount', splits: [{ debtorExternalId: externalId, amountDue: 333 }, { debtorUserId: memberId, amountDue: 100 }] } })
      expect(updated.status()).toBe(200)
      const saved = await updated.json()
      expect(saved.splits[0]).toMatchObject({ debtorExternalId: externalId, debtorExternalName: 'e2euser_friend', amountDue: 333 })
      expect((await (await page.request.get('/api/fixed-costs', { headers })).json())[0]).toEqual(saved)
      const hidden = await (await memberPage.request.get('/api/fixed-costs', { headers: memberHeaders })).json()
      expect(hidden[0]).toMatchObject({ splitInputType: null, splits: [], editable: false })
      const legacy = await page.request.post('/api/fixed-costs', { headers, data: { ...data, splits: [{ debtorUserId: memberId, ratio: 50 }] } })
      expect(legacy.status()).toBe(201)
      const noSplits = await page.request.post('/api/fixed-costs', { headers, data: { name: '[E2E_TEST] no splits', amount: 100, paymentDay: 2, personal: false } })
      expect(noSplits.status()).toBe(201)
    } finally {
      await context.close()
      await otherContext.close()
    }
  })
}
