import { isValidCalendarDate, utcTimestampToJstDate } from './date'

export type FixedCostPostingStatus = 'posted' | 'scheduled' | 'missing' | 'suppressed' | 'not_applicable' | 'unknown'
export interface PostedFixedCostExpense { id: number; expenseDate: string; amount: number }
export interface FixedCostStatusInput {
  createdByUserId: number
  userId: number
  paymentDate: string
  today: string
  createdAt: string
  effectiveFrom: string | null
  postedExpense: PostedFixedCostExpense | null
  suppressed: boolean
}

/** 現在の支払日設定を対象月の月末に丸める。履歴を復元するものではない。 */
export function fixedCostPaymentDate(yearMonth: string, paymentDay: number): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return yearMonth + '-' + Math.min(paymentDay, lastDay).toString().padStart(2, '0')
}

/** 取得済みの認可された根拠だけを分類する。計上や実決済を行わない。 */
export function fixedCostDisplayStatus(input: FixedCostStatusInput): FixedCostPostingStatus {
  if (input.createdByUserId !== input.userId) return 'unknown'
  if (input.postedExpense) return 'posted'
  if (input.suppressed) return 'suppressed'

  const timestampText = input.createdAt.replace(' ', 'T')
  const createdTimestamp = new Date(timestampText + 'Z')
  if (Number.isNaN(createdTimestamp.getTime()) || createdTimestamp.toISOString().slice(0, 19) !== timestampText) return 'unknown'
  const createdDate = utcTimestampToJstDate(input.createdAt)
  if (!isValidCalendarDate(createdDate)) return 'unknown'
  if (input.paymentDate < createdDate) return 'not_applicable'
  if (input.paymentDate.slice(0, 7) < input.today.slice(0, 7)) return 'unknown'
  if (!input.effectiveFrom || !isValidCalendarDate(input.effectiveFrom)) return 'unknown'
  // effective_fromは遅延回収の境界。当日Cronの対象外判定に流用しない。
  if (input.paymentDate >= input.today) return 'scheduled'
  if (input.paymentDate > input.effectiveFrom && input.paymentDate.slice(0, 7) === input.today.slice(0, 7)) return 'missing'
  return 'unknown'
}
