// クエリパラメータを整数として解釈する。値が無ければundefined、非数値ならnullを返す
// (呼び出し側でnullの場合を400バリデーションエラーとして扱う)。
export function parseOptionalIntQueryParam(value: string | undefined): number | undefined | null {
  if (value === undefined) {
    return undefined
  }
  if (!/^-?\d+$/.test(value)) {
    return null
  }
  return Number(value)
}
