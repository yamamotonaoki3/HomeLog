// HTMLRewriter の getAttribute・text は HTML の文字参照を元の文字に戻さないため、
// URL からのレシピ登録で取り出したタイトル・画像URLをここで戻す(#312)。
// Instagram などは og:title の日本語を数値文字参照(&#x30ec; 等)で埋め込んでいる。
const NAMED: Record<string, string> = Object.assign(Object.create(null), {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(0xa0),
}) as Record<string, string>

// 末尾にセミコロンのある参照だけを戻す。名前の表はプロトタイプを持たせず、&constructor; などを誤って置き換えない。
// 範囲外・サロゲートのコードポイントや未知の名前はそのまま残す。
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body] ?? whole
    const codePoint = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint === 0) return whole
    return String.fromCodePoint(codePoint)
  })
}
