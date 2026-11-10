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

/** "YYYY-MM-DD"形式の文字列を、端末のタイムゾーンでのその日の0時として読み取る。 */
function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "YYYY-MM-DD"形式の月曜日から、指定週数だけ前後した週の月曜日を算出する(負数で前週方向)。 */
export function addWeeks(weekStartDate: string, weeks: number): string {
  const date = parseDate(weekStartDate)
  date.setDate(date.getDate() + weeks * 7)
  return formatDate(date)
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * 週の期間を「2026年11月2日（月）〜11月8日（日）」の形で返す。
 * 年をまたぐ週だけ、終わりの日付にも年を付ける。
 */
export function formatWeekRange(weekStartDate: string): string {
  const start = parseDate(weekStartDate)
  const end = parseDate(weekStartDate)
  end.setDate(end.getDate() + 6)
  const label = (date: Date, withYear: boolean) =>
    `${withYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_LABELS[date.getDay()]}）`
  return `${label(start, true)}〜${label(end, end.getFullYear() !== start.getFullYear())}`
}

/**
 * 週を「11月 第1週」の形で返す。週の月曜日が、その月の何回目の月曜日かで数える
 * (月をまたぐ週は、月曜日が属する月の週として扱う)。
 */
export function formatWeekOfMonth(weekStartDate: string): string {
  const start = parseDate(weekStartDate)
  return `${start.getMonth() + 1}月 第${Math.ceil(start.getDate() / 7)}週`
}
