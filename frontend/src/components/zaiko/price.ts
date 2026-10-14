export const PRICE_ERROR = '値段は0〜9,999,999,999円の整数で入力してください'
export function validPrice(value: string) {
  const trimmed = value.trim()
  return trimmed === '' || (/^\d+$/.test(trimmed) && Number(trimmed) <= 9999999999)
}
export function formatPrice(value: number | null | undefined) {
  return value == null ? '未設定' : `${value.toLocaleString('ja-JP')}円`
}
