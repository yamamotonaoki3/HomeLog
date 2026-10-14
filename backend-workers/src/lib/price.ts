import { z } from 'zod'

// 円単位の参考値。数量とは独立して在庫IDごとに最後の値だけを保持する。
export const priceSchema = z.number().int().min(0).max(9_999_999_999).nullable().optional()
