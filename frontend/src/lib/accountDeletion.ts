// 退会の削除予定日を「2030/2/14」の形で表示する(#298)。
export function formatDeletionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
}
