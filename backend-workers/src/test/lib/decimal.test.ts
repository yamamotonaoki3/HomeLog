import { describe, expect, it } from 'vitest'
import { fromTenths, isOneDecimalPlace, toTenths } from '../../lib/decimal'

describe('isOneDecimalPlace', () => {
  it('整数はtrue', () => {
    expect(isOneDecimalPlace(5)).toBe(true)
  })

  it('小数点第一位までの値はtrue', () => {
    expect(isOneDecimalPlace(0.1)).toBe(true)
    expect(isOneDecimalPlace(99999.9)).toBe(true)
  })

  it('小数点第二位以下を含む値はfalse', () => {
    expect(isOneDecimalPlace(0.15)).toBe(false)
    expect(isOneDecimalPlace(1.23)).toBe(false)
  })
})

describe('toTenths / fromTenths', () => {
  it('相互変換できる', () => {
    expect(toTenths(1.5)).toBe(15)
    expect(fromTenths(15)).toBe(1.5)
    expect(toTenths(0)).toBe(0)
    expect(fromTenths(0)).toBe(0)
  })

  it('0.1の繰り返し加算でも誤差が出ない', () => {
    let tenths = toTenths(1.0)
    for (let i = 0; i < 10; i += 1) {
      tenths += toTenths(0.1)
    }
    expect(fromTenths(tenths)).toBe(2.0)
  })
})
