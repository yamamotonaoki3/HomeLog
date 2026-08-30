import { describe, expect, it } from 'vitest'
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from '../../lib/crypto'

describe('hashPassword / verifyPassword', () => {
  it('正しいパスワードで検証が成功する', async () => {
    const hash = await hashPassword('TestPass123!')

    await expect(verifyPassword('TestPass123!', hash)).resolves.toBe(true)
  })

  it('誤ったパスワードで検証が失敗する', async () => {
    const hash = await hashPassword('TestPass123!')

    await expect(verifyPassword('WrongPass123!', hash)).resolves.toBe(false)
  })

  it('同じパスワードでもハッシュ値は毎回異なる(ソルトが異なる)', async () => {
    const hash1 = await hashPassword('TestPass123!')
    const hash2 = await hashPassword('TestPass123!')

    expect(hash1).not.toBe(hash2)
  })
})

describe('generateOpaqueToken', () => {
  it('毎回異なるトークンを生成する', () => {
    const token1 = generateOpaqueToken()
    const token2 = generateOpaqueToken()

    expect(token1).not.toBe(token2)
    expect(token1.length).toBeGreaterThan(30)
  })
})

describe('sha256Hex', () => {
  it('同じ入力に対して同じハッシュ値を返す(決定的)', async () => {
    const hash1 = await sha256Hex('same-input')
    const hash2 = await sha256Hex('same-input')

    expect(hash1).toBe(hash2)
  })

  it('異なる入力に対して異なるハッシュ値を返す', async () => {
    const hash1 = await sha256Hex('input-a')
    const hash2 = await sha256Hex('input-b')

    expect(hash1).not.toBe(hash2)
  })
})
