import { describe, expect, it } from 'vitest'
import { formatJstToday, isValidCalendarDate } from '../../lib/date'

describe('formatJstToday', () => {
  it('YYYY-MM-DD形式の実在する日付を返す', () => {
    const value = formatJstToday()
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isValidCalendarDate(value)).toBe(true)
  })
})

describe('isValidCalendarDate', () => {
  it('実在する日付はtrue', () => {
    expect(isValidCalendarDate('2024-01-01')).toBe(true)
    expect(isValidCalendarDate('2024-02-29')).toBe(true) // うるう年
  })

  it('存在しない日付はfalse', () => {
    expect(isValidCalendarDate('2024-02-31')).toBe(false)
    expect(isValidCalendarDate('2023-02-29')).toBe(false) // うるう年ではない
    expect(isValidCalendarDate('2024-13-01')).toBe(false)
    expect(isValidCalendarDate('2024-00-01')).toBe(false)
  })

  it('形式が不正な場合はfalse', () => {
    expect(isValidCalendarDate('2024/01/01')).toBe(false)
    expect(isValidCalendarDate('not-a-date')).toBe(false)
  })
})
