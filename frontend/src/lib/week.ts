// 献立表(F-10)は「週単位(week_start_date=その週の月曜日)」でデータを扱うため、
// 基準日から月曜日を算出したり、前週・次週の月曜日を算出したりするための小さなヘルパー集。

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * 指定した日付が属する週の月曜日を"YYYY-MM-DD"形式で返す。
 * `getDay()`は日曜=0, 月曜=1, ..., 土曜=6を返すため、月曜日までの差分日数を計算して引く
 * (日曜(0)の場合だけ「6日前」ではなく「その週の月曜」まで6日戻る特殊ケースになる)。
 */
export function getMondayOf(date: Date): string {
  const day = date.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(date)
  monday.setDate(date.getDate() - diffToMonday)
  return formatDate(monday)
}

/** "YYYY-MM-DD"形式の月曜日から、指定週数だけ前後した週の月曜日を算出する(負数で前週方向)。 */
export function addWeeks(weekStartDate: string, weeks: number): string {
  const [year, month, day] = weekStartDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + weeks * 7)
  return formatDate(date)
}
