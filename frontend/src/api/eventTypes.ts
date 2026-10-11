// GET/POST/PATCH /api/events から返ってくるイベント1件分の形。
export interface Event {
  id: number
  name: string
  eventDate: string
  isAllDay: boolean
  startTime: string | null
  endTime: string | null
  recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  notifyEnabled: boolean
  defaultAmount: number | null
  showOnDashboard: boolean
  personal: boolean
  editable: boolean
}

export const RECURRENCE_LABELS: Record<Event['recurrenceType'], string> = {
  none: '単発',
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  yearly: '毎年',
}

// 終日は「終日」、時刻指定は「9:00〜12:00」(終了時刻あり)/「9:00〜」(終了時刻未定)と表示する
// (F06_kakeibo_event.md 5-2章、S-09イベント一覧の表示仕様)。
export function timeRangeLabel(event: Pick<Event, 'isAllDay' | 'startTime' | 'endTime'>): string {
  if (event.isAllDay) {
    return '終日'
  }
  return event.endTime ? `${event.startTime}〜${event.endTime}` : `${event.startTime}〜`
}

export type SummaryPeriod = 'year' | 'month'

// GET /api/events/:id/summary から返ってくる集計結果の形。
export interface EventSummary {
  total: number
}
