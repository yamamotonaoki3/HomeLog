/**
 * JST(UTC+9)基準の「今日」を返す。JSTには夏時間が無いため、常にUTC+9時間の固定オフセットで
 * 問題ない。戻り値のDateはUTCのgetter(getUTCFullYear等)で読むとJSTの年月日と一致する
 * (fixed-cost-posting.tsのpostDueFixedCostsと同じ扱い方)。
 */
export function getJstToday(): Date {
  const nowUtc = new Date()
  return new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000)
}

/** JST基準の日付から、当月の開始日("YYYY-MM-01")と翌月の開始日("YYYY-MM-01")を算出する。 */
export function currentMonthRange(jstToday: Date): { monthStart: string; nextMonthStart: string } {
  const year = jstToday.getUTCFullYear()
  const month = jstToday.getUTCMonth() + 1
  const pad2 = (value: number): string => value.toString().padStart(2, '0')
  const monthStart = `${year}-${pad2(month)}-01`
  const nextMonthDate = new Date(Date.UTC(year, month, 1))
  const nextMonthStart = `${nextMonthDate.getUTCFullYear()}-${pad2(nextMonthDate.getUTCMonth() + 1)}-01`
  return { monthStart, nextMonthStart }
}

// YYYY-MM-DD形式の文字列が、形式だけでなく実在するカレンダー日付かどうかを検証する。
// 例えば"2024-02-31"は正規表現の形式チェックだけでは通ってしまうため、実際に
// Dateとして構築し、年月日が元の入力と一致するか(2/31が3/2に繰り上がっていないか)を確認する。
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const [, yearStr, monthStr, dayStr] = match
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)

  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * YYYY-MM-DD形式の文字列が「その週の月曜日」を指しているかどうかを検証する
 * (F10_kondate_menu.mdの通り、menu_entries.week_start_dateは常にその週の月曜日である必要がある)。
 * 先に実在するカレンダー日付であることを確認してから、曜日を判定する。
 * `getUTCDay()`は日曜=0, 月曜=1, ..., 土曜=6を返すため、1と等しいかで判定する。
 */
export function isMonday(value: string): boolean {
  if (!isValidCalendarDate(value)) {
    return false
  }
  const [yearStr, monthStr, dayStr] = value.split('-')
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)))
  return date.getUTCDay() === 1
}
