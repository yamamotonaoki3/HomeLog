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
