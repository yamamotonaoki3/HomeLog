import { describe, expect, it } from 'vitest'
import { formatWeekOfMonth, formatWeekRange } from '../../lib/week'

describe('formatWeekRange', () => {
  it.each([
    ['同じ月の中', '2026-11-02', '2026年11月2日（月）〜11月8日（日）'],
    ['月をまたぐ', '2026-11-30', '2026年11月30日（月）〜12月6日（日）'],
    ['年をまたぐときは終わりにも年を付ける', '2026-12-28', '2026年12月28日（月）〜2027年1月3日（日）'],
  ])('%s', (_name, monday, expected) => {
    expect(formatWeekRange(monday)).toBe(expected)
  })
})

describe('formatWeekOfMonth', () => {
  // 週の月曜日が、その月の何回目の月曜日かで数える。
  it.each([
    ['2026-11-02', '11月 第1週'],
    ['2026-11-09', '11月 第2週'],
    ['2026-11-30', '11月 第5週'],
    ['2026-12-28', '12月 第4週'],
    ['2027-01-04', '1月 第1週'],
  ])('%s は %s', (monday, expected) => {
    expect(formatWeekOfMonth(monday)).toBe(expected)
  })
})
