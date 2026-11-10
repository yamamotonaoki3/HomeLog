import { ORDERABLE_CARDS, type OrderableCard } from '../api/userSettingsTypes'

// ホームのカードの開閉(#493)。閉じているカードを、利用者ごとにこの端末(ブラウザ)へ記憶する。
// サーバーには保存しない。記憶が無い・壊れている・利用者が分からないときは、すべて開いた状態として扱う。
const prefix = 'homelog.dashboardCollapsedCards.v1'

function storageKey(userId: number | null): string | null {
  return userId != null && Number.isSafeInteger(userId) && userId > 0 ? prefix + ':' + userId : null
}

export function readCollapsedCards(userId: number | null): OrderableCard[] {
  const key = storageKey(userId)
  if (!key) return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return ORDERABLE_CARDS.filter((card) => value.includes(card))
  } catch {
    return []
  }
}

export function writeCollapsedCards(userId: number | null, cards: OrderableCard[]): void {
  const key = storageKey(userId)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(ORDERABLE_CARDS.filter((card) => cards.includes(card))))
  } catch {
    // 記憶できないブラウザでも、その場の開閉は続けられる。
  }
}
