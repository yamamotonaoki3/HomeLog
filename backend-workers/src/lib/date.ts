/**
 * JST(UTC+9)基準の「今日」を返す。JSTには夏時間が無いため、常にUTC+9時間の固定オフセットで
 * 問題ない。戻り値のDateはUTCのgetter(getUTCFullYear等)で読むとJSTの年月日と一致する
 * (fixed-cost-posting.tsのpostDueFixedCostsと同じ扱い方)。
 */
export function getJstToday(): Date {
  const nowUtc = new Date()
  return new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000)
}

/** JST基準の「今日」を "YYYY-MM-DD" 形式で返す(割り勘精算の家計簿記録の日付等に使う)。 */
export function formatJstToday(): string {
  return getJstToday().toISOString().slice(0, 10)
}

/**
 * SQLiteの current_timestamp("YYYY-MM-DD HH:MM:SS"、UTC)を JST基準の日付("YYYY-MM-DD")に変換する。
 * 明示的な日付列を持たない card_charges 等の created_at から「取引日」を求めるのに使う。
 * パースできない場合は先頭10文字をそのまま返す(フォールバック)。
 */
export function utcTimestampToJstDate(utcTimestamp: string): string {
  const parsed = new Date(`${utcTimestamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed.getTime())) {
    return utcTimestamp.slice(0, 10)
  }
  return new Date(parsed.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
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
