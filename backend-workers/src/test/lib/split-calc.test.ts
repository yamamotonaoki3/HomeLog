import { describe, expect, it } from 'vitest'
import { resolveSplits } from '../../lib/split-calc'

describe('resolveSplits(ratio モード)', () => {
  it('相手50%で負担額を折半する(残りは支払者)', () => {
    const result = resolveSplits(1000, 'ratio', [{ key: 'a', ratio: 50 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amountDue).toBe(500)
  })

  it('3人均等割りで端数は支払者に残る(相手は切り捨て)', () => {
    const result = resolveSplits(1000, 'ratio', [
      { key: 'a', ratio: 33.33 },
      { key: 'b', ratio: 33.33 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows.map((r) => r.amountDue)).toEqual([333, 333]) // 支払者が 1000-666=334 を負担
  })

  it('相手の割合合計が100を超えるとエラー', () => {
    const result = resolveSplits(1000, 'ratio', [
      { key: 'a', ratio: 60 },
      { key: 'b', ratio: 60 },
    ])
    expect(result.ok).toBe(false)
  })

  it('相手が0人だとエラー', () => {
    expect(resolveSplits(1000, 'ratio', []).ok).toBe(false)
  })
})

describe('resolveSplits(amount モード)', () => {
  it('相手の負担額から割合を逆算する', () => {
    const result = resolveSplits(1000, 'amount', [{ key: 'a', amountDue: 400 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0].amountDue).toBe(400)
    expect(result.rows[0].ratio).toBe(40)
  })

  it('相手の負担額合計が支出金額を超えるとエラー', () => {
    const result = resolveSplits(1000, 'amount', [
      { key: 'a', amountDue: 600 },
      { key: 'b', amountDue: 600 },
    ])
    expect(result.ok).toBe(false)
  })
})
