import { describe, expect, it } from 'vitest'
import { filterByKeyword, normalizeKeyword } from '../../lib/keyword'

describe('normalizeKeyword', () => {
  it.each([
    ['ミルク', 'みるく'],
    ['ﾐﾙｸ', 'みるく'],
    ['ヴィーガン', 'ゔぃーがん'],
    ['  ＭＩＬＫ ', 'milk'],
  ])('%s を %s に揃える (#326)', (input, expected) => {
    expect(normalizeKeyword(input)).toBe(expected)
  })
})

describe('filterByKeyword', () => {
  const names = ['[E2E_TEST] ミルク', '[E2E_TEST] みるくティー', '[E2E_TEST] 牛乳']

  it.each(['みるく', 'ミルク', 'ﾐﾙｸ'])('%s でカタカナ・ひらがな両方の品名が見つかる (#326)', (keyword) => {
    expect(filterByKeyword(names, keyword, (name) => name)).toEqual(['[E2E_TEST] ミルク', '[E2E_TEST] みるくティー'])
  })

  it('漢字は読みでは見つからず、空のキーワードは全件を返す', () => {
    expect(filterByKeyword(names, 'ぎゅうにゅう', (name) => name)).toEqual([])
    expect(filterByKeyword(names, ' ', (name) => name)).toEqual(names)
  })
})
