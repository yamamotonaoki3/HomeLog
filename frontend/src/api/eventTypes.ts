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

export type SummaryPeriod = 'year' | 'month'

// GET /api/events/:id/summary から返ってくる集計結果の形。
export interface EventSummary {
  total: number
}
