import { expect, test } from './console-guard'
import { newUser } from './support/test-data'

// パスワード再設定のAPI契約(#401)。実GAS・実メールには接続しない。
// ローカルのwrangler devは、メール送信が未設定(停止中)の既定構成で起動する。
test.describe('パスワード再設定APIの契約', () => {
  test('利用可否の判定と、登録有無で変わらない申請応答', async ({ page, request, consoleGuard }) => {
    consoleGuard.watch(page)
    const user = newUser('pwreset')
    expect((await request.post('/api/auth/register', { data: user })).status()).toBe(201)

    const availability = await request.get('/api/auth/password-reset/availability')
    expect(availability.status()).toBe(200)
    expect(availability.headers()['cache-control']).toBe('no-store')
    const { available } = await availability.json()
    expect(typeof available).toBe('boolean')

    const registered = await request.post('/api/auth/password-reset/request', { data: { email: user.email } })
    const unknown = await request.post('/api/auth/password-reset/request', { data: { email: `nobody_${Date.now()}@example.com` } })
    expect(registered.status()).toBe(unknown.status())
    expect(await registered.json()).toEqual(await unknown.json())
    // 利用不可なら503、可能(ローカル用ログ経路)なら200。利用者を架空の送信完了へ誘導しない。
    expect(registered.status()).toBe(available ? 200 : 503)
    if (!available) {
      expect(await registered.json()).toMatchObject({ code: 'PASSWORD_RESET_UNAVAILABLE' })
    }
  })

  test('申請の入力検証と確認APIの拒否(不正トークン)', async ({ page, request, consoleGuard }) => {
    consoleGuard.watch(page)
    const { available } = await (await request.get('/api/auth/password-reset/availability')).json()
    const invalid = await request.post('/api/auth/password-reset/request', { data: { email: 'not-an-email' } })
    expect(invalid.status()).toBe(available ? 400 : 503)

    const confirm = await request.post('/api/auth/password-reset/confirm', { data: { token: 'invalid-token-value', newPassword: 'NewPass456!' } })
    expect(confirm.status()).toBe(400)
    expect(await confirm.json()).toMatchObject({ code: 'INVALID_TOKEN' })
  })
})
