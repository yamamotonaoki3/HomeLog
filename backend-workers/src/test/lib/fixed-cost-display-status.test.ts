import { describe, expect, it } from 'vitest'
import { fixedCostDisplayStatus, fixedCostPaymentDate, type FixedCostStatusInput } from '../../lib/fixed-cost-display-status'

const postedExpense = { id: 12, expenseDate: '2026-11-05', amount: 80000 }
const base: FixedCostStatusInput = {
  createdByUserId: 1, userId: 1, paymentDate: '2026-11-05', today: '2026-11-07',
  createdAt: '2026-10-01 00:00:00', effectiveFrom: '2026-10-01', postedExpense: null, suppressed: false,
}

describe('固定費の読み取り専用表示状態', () => {
  it.each([
    [{ postedExpense }, 'posted'],
    [{ postedExpense, suppressed: true }, 'posted'],
    [{ suppressed: true }, 'suppressed'],
    [{ paymentDate: '2026-11-01', createdAt: '2026-11-01 15:00:00' }, 'not_applicable'],
    [{ paymentDate: '2026-10-05' }, 'unknown'],
    [{ effectiveFrom: null }, 'unknown'],
    [{ effectiveFrom: '2026-02-30' }, 'unknown'],
    [{ effectiveFrom: '2026-11-05' }, 'unknown'],
    [{ effectiveFrom: '2026-11-06' }, 'unknown'],
    [{ paymentDate: '2026-11-07', effectiveFrom: '2026-11-07' }, 'scheduled'],
    [{ paymentDate: '2026-11-08' }, 'scheduled'],
    [{ paymentDate: '2026-12-05' }, 'scheduled'],
    [{}, 'missing'],
    [{ createdAt: 'invalid' }, 'unknown'],
    [{ createdAt: '2026-02-30 00:00:00' }, 'unknown'],
  ] as const)('根拠 %j の状態は %s', (overrides, status) => {
    expect(fixedCostDisplayStatus({ ...base, ...overrides })).toBe(status)
  })

  it.each([{}, { postedExpense }, { suppressed: true }, { postedExpense, suppressed: true }])('共有他者は関連記録 %j にかかわらずunknown', (overrides) => {
    expect(fixedCostDisplayStatus({ ...base, ...overrides, createdByUserId: 2 })).toBe('unknown')
  })

  it('JST当日は予定、翌日になってから回収対象の無記録となる', () => {
    expect(fixedCostDisplayStatus({ ...base, today: '2026-11-05' })).toBe('scheduled')
    expect(fixedCostDisplayStatus({ ...base, today: '2026-11-06' })).toBe('missing')
  })

  it('作成JST日と予定日が同じなら作成前とは断定しない', () => {
    expect(fixedCostDisplayStatus({ ...base, createdAt: '2026-11-04 15:00:00', effectiveFrom: '2026-11-05' })).toBe('unknown')
  })

  it('確実な記録は過去月や欠損履歴より優先する', () => {
    expect(fixedCostDisplayStatus({ ...base, paymentDate: '2026-10-05', effectiveFrom: null, postedExpense })).toBe('posted')
    expect(fixedCostDisplayStatus({ ...base, effectiveFrom: null, suppressed: true })).toBe('suppressed')
  })

  it.each([['2026-02', 31, '2026-02-28'], ['2028-02', 31, '2028-02-29'], ['2026-11', 31, '2026-11-30'], ['2026-12', 1, '2026-12-01']] as const)('月末丸め %s / %s', (month, day, expected) => {
    expect(fixedCostPaymentDate(month, day)).toBe(expected)
  })
})
