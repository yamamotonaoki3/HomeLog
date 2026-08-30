// 数量・閾値等、小数点第一位までの数値をDB格納用の整数(10倍値)と相互変換するユーティリティ。
// SQLiteのfloat演算誤差を避けるため、DBには常に整数(tenths)で保持する(src/db/schema.ts参照)。

const EPSILON = 1e-9
export const MAX_VALUE = 99999.9

/** 値が小数点第一位まで(0.1刻み)かどうかを判定する。 */
export function isOneDecimalPlace(value: number): boolean {
  const tenths = value * 10
  return Math.abs(tenths - Math.round(tenths)) < EPSILON
}

/** API入力値(例: 1.5)をDB格納用の整数(例: 15)に変換する。 */
export function toTenths(value: number): number {
  return Math.round(value * 10)
}

/** DB格納値(例: 15)をAPI出力用の数値(例: 1.5)に変換する。 */
export function fromTenths(tenths: number): number {
  return tenths / 10
}
