// 全角・半角の英数字や大文字・小文字、カタカナ・ひらがなの違いを無視して比較するための正規化(献立表のレシピ検索・在庫と買い物リストの検索で共通)。
// バックエンドの在庫の品名重複判定(backend-workers/src/routes/inventory-items.ts の normalizeName)と同じ規則(#326)。
export function normalizeKeyword(value: string) {
  return value.normalize('NFKC').toLowerCase().trim()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

// 名前がキーワードを含むものだけを返す。キーワードが空なら全件を返す。
export function filterByKeyword<T>(items: T[], keyword: string, nameOf: (item: T) => string): T[] {
  const normalized = normalizeKeyword(keyword)
  return normalized === '' ? items : items.filter((item) => normalizeKeyword(nameOf(item)).includes(normalized))
}
