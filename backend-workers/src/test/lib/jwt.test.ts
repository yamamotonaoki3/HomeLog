import { describe, expect, it } from 'vitest'
import { signAccessToken, verifyAccessToken } from '../../lib/jwt'

const SECRET = 'test-secret-must-be-long-enough-for-hmac'

describe('signAccessToken / verifyAccessToken', () => {
  it('発行したトークンからuserIdを復元できる', async () => {
    const token = await signAccessToken(42, SECRET, 900)

    const userId = await verifyAccessToken(token, SECRET)
    expect(userId).toBe(42)
  })

  it('異なるシークレットで検証すると失敗する', async () => {
    const token = await signAccessToken(42, SECRET, 900)

    await expect(verifyAccessToken(token, 'different-secret-also-long-enough')).rejects.toThrow()
  })

  it('期限切れのトークンは検証に失敗する', async () => {
    const token = await signAccessToken(42, SECRET, -1)

    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow()
  })
})
