// F-06 イベント管理(docs/details/features/F06_kakeibo_event.md 5章)の繰り返し設定から、
// 指定した期間内に実際にそのイベントが発生する日付の一覧を算出する純粋関数群。
// UTC日付演算で統一する(このファイル単体では時刻・タイムゾーンを扱わないため、
// 呼び出し側が渡す日付文字列はすでにJST基準等で解決済みの前提とする)。

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurringEvent {
  eventDate: string
  recurrenceType: RecurrenceType
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

/** その年月の末日を返す(月は1-12)。 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 繰り返し設定と対象期間(rangeStart〜rangeEnd、両端含む、"YYYY-MM-DD")から、
 * イベントが実際に発生する日付の一覧を昇順で返す。
 *
 * - none: event_dateが範囲内にあれば1件のみ
 * - daily: event_date以降かつ範囲内の全日
 * - weekly: event_dateと同じ曜日で、event_date以降かつ範囲内の日付
 * - monthly: event_dateと同じ日(その月にその日が存在しない場合はスキップ。
 *   例: 起点が31日の場合、30日までしかない月には発生しない)
 * - yearly: event_dateと同じ月日(閏日(2/29)起点の場合、閏年でない年はスキップ)
 */
export function resolveOccurrences(event: RecurringEvent, rangeStart: string, rangeEnd: string): string[] {
  const eventDate = parseDate(event.eventDate)
  const start = parseDate(rangeStart)
  const end = parseDate(rangeEnd)
  const occurrences: string[] = []

  if (event.recurrenceType === 'none') {
    if (eventDate >= start && eventDate <= end) {
      occurrences.push(formatDate(eventDate))
    }
    return occurrences
  }

  // daily/weekly/monthly/yearlyはいずれも「event_date以降」が対象(過去に遡って発生しない)。
  const effectiveStart = eventDate > start ? eventDate : start

  if (event.recurrenceType === 'daily') {
    const cursor = new Date(effectiveStart)
    while (cursor <= end) {
      occurrences.push(formatDate(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return occurrences
  }

  if (event.recurrenceType === 'weekly') {
    // effectiveStartから、event_dateと同じ曜日になる直近の日まで進める。
    const cursor = new Date(effectiveStart)
    const diff = (eventDate.getUTCDay() - cursor.getUTCDay() + 7) % 7
    cursor.setUTCDate(cursor.getUTCDate() + diff)
    while (cursor <= end) {
      occurrences.push(formatDate(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    }
    return occurrences
  }

  if (event.recurrenceType === 'monthly') {
    const day = eventDate.getUTCDate()
    let year = effectiveStart.getUTCFullYear()
    let month = effectiveStart.getUTCMonth() + 1
    // effectiveStartが月の途中から始まる場合、その月のevent_date相当日が既に過ぎていないか
    // (effectiveStart自身がeventDateの月と同じ場合はevent_date当日から始まるため問題ないが、
    // 一般化のためeffectiveStartの年月から順に判定していく)。
    const endYear = end.getUTCFullYear()
    const endMonth = end.getUTCMonth() + 1
    while (year < endYear || (year === endYear && month <= endMonth)) {
      if (day <= lastDayOfMonth(year, month)) {
        const candidate = new Date(Date.UTC(year, month - 1, day))
        if (candidate >= effectiveStart && candidate <= end) {
          occurrences.push(formatDate(candidate))
        }
      }
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    return occurrences
  }

  // yearly
  const month = eventDate.getUTCMonth() + 1
  const day = eventDate.getUTCDate()
  let year = effectiveStart.getUTCFullYear()
  const endYear = end.getUTCFullYear()
  while (year <= endYear) {
    if (day <= lastDayOfMonth(year, month)) {
      const candidate = new Date(Date.UTC(year, month - 1, day))
      if (candidate >= effectiveStart && candidate <= end) {
        occurrences.push(formatDate(candidate))
      }
    }
    year += 1
  }
  return occurrences
}
