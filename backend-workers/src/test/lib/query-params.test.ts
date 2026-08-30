import { describe, expect, it } from 'vitest'
import { parseOptionalIntQueryParam } from '../../lib/query-params'

describe('parseOptionalIntQueryParam', () => {
  it('未指定の場合はundefinedを返す', () => {
    expect(parseOptionalIntQueryParam(undefined)).toBeUndefined()
  })

  it('数値文字列の場合は数値に変換する', () => {
    expect(parseOptionalIntQueryParam('123')).toBe(123)
  })

  it('数値でない場合はnullを返す', () => {
    expect(parseOptionalIntQueryParam('abc')).toBeNull()
    expect(parseOptionalIntQueryParam('12.5')).toBeNull()
    expect(parseOptionalIntQueryParam('')).toBeNull()
  })
})
