import { describe, expect, it } from 'vitest'
import { resolveSplits, type SplitInputRow } from '../../lib/split-calc'

const payer = (over: Partial<SplitInputRow> = {}): SplitInputRow => ({ key: 'payer', isPayer: true, ...over })
const debtor = (key: string, over: Partial<SplitInputRow> = {}): SplitInputRow => ({ key, isPayer: false, ...over })

describe('resolveSplits(ratio モード)', () => {
  it('2人50:50で負担額を折半する', () => {
    const result = resolveSplits(1000, 'ratio', [payer({ ratio: 50 }), debtor('a', { ratio: 50 })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const a = result.rows.find((r) => r.key === 'a')!
    expect(a.amountDue).toBe(500)
    const p = result.rows.find((r) => r.isPayer)!
    expect(p.amountDue).toBe(500)
  })

  it('3人均等割りで端数を支払者へ寄せる', () => {
    const result = resolveSplits(1000, 'ratio', [
      payer({ ratio: 33.34 }),
      debtor('a', { ratio: 33.33 }),
      debtor('b', { ratio: 33.33 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const a = result.rows.find((r) => r.key === 'a')!
    const b = result.rows.find((r) => r.key === 'b')!
    const p = result.rows.find((r) => r.isPayer)!
    expect(a.amountDue).toBe(333)
    expect(b.amountDue).toBe(333)
    expect(p.amountDue).toBe(334) // 1000 - 333 - 333(端数を吸収)
  })

  it('割合の合計が100でないとエラー', () => {
    const result = resolveSplits(1000, 'ratio', [payer({ ratio: 40 }), debtor('a', { ratio: 40 })])
    expect(result.ok).toBe(false)
  })

  it('相手が1人もいないとエラー', () => {
    const result = resolveSplits(1000, 'ratio', [payer({ ratio: 100 })])
    expect(result.ok).toBe(false)
  })
})

describe('resolveSplits(amount モード)', () => {
  it('負担額の合計が支出金額に一致すれば割合を逆算する', () => {
    const result = resolveSplits(1000, 'amount', [
      payer({ amountDue: 600 }),
      debtor('a', { amountDue: 400 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const a = result.rows.find((r) => r.key === 'a')!
    expect(a.amountDue).toBe(400)
    expect(a.ratio).toBe(40)
  })

  it('合計が一致しないとエラー(差額メッセージ付き)', () => {
    const result = resolveSplits(1000, 'amount', [
      payer({ amountDue: 600 }),
      debtor('a', { amountDue: 300 }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('100')
  })
})
