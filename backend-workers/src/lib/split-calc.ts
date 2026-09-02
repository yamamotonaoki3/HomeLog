// F-04 割り勘の負担額・負担割合の計算(docs/details/features/F04_kakeibo_warikan.md 7章)。
// ルート層から切り出した純粋関数。DB・認証には一切依存しない(テストしやすさのため)。
//
// 支払者(expenses.payer_user_id)は全額を立て替えている前提。この関数が扱うのは「支払者以外の参加者」
// だけで、支払者自身の負担分(端数を含む)は「支出金額 - 相手の負担額合計」として暗黙に決まる
// (ドキュメント7章「端数は代表者=支払った人へ寄せる」)。

export type SplitInputType = 'ratio' | 'amount'

// 支払者以外の1参加者の入力。key は呼び出し側が結果を対応付けるための識別子(userId/externalId等)。
export interface SplitInputRow {
  key: string
  // ratio モードのとき使用(％)。
  ratio?: number | null
  // amount モードのとき使用(円)。
  amountDue?: number | null
}

export interface ResolvedSplitRow {
  key: string
  ratio: number
  amountDue: number
}

export type SplitCalcResult =
  | { ok: true; rows: ResolvedSplitRow[] }
  | { ok: false; error: string }

const RATIO_SUM_TOLERANCE = 0.01

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 割り勘の相手(支払者以外)の入力を検証し、各自の負担割合・負担額を確定する。
 *
 * - ratio モード: 相手の割合合計が 100 以下であること(残りは支払者の負担)。負担額 = floor(金額 × 割合 / 100)。
 * - amount モード: 相手の負担額合計が支出金額以下であること。割合は amount からの逆算(参考値)。
 */
export function resolveSplits(
  expenseAmount: number,
  inputType: SplitInputType,
  rows: SplitInputRow[],
): SplitCalcResult {
  if (!Number.isInteger(expenseAmount) || expenseAmount <= 0) {
    return { ok: false, error: '支出金額が不正です' }
  }
  if (rows.length < 1) {
    return { ok: false, error: '割り勘の相手を1人以上指定してください' }
  }

  if (inputType === 'ratio') {
    for (const row of rows) {
      if (row.ratio == null || !Number.isFinite(row.ratio) || row.ratio < 0 || row.ratio > 100) {
        return { ok: false, error: '負担割合は0〜100%で入力してください' }
      }
    }
    const ratioSum = rows.reduce((sum, row) => sum + (row.ratio ?? 0), 0)
    if (ratioSum - 100 > RATIO_SUM_TOLERANCE) {
      return { ok: false, error: `負担割合の合計が100%を超えています(現在 ${round2(ratioSum)}%)` }
    }
    return {
      ok: true,
      rows: rows.map((row) => {
        const ratio = row.ratio ?? 0
        return { key: row.key, ratio: round2(ratio), amountDue: Math.floor((expenseAmount * ratio) / 100) }
      }),
    }
  }

  // amount モード
  for (const row of rows) {
    if (row.amountDue == null || !Number.isInteger(row.amountDue) || row.amountDue < 0) {
      return { ok: false, error: '負担額は0以上の整数で入力してください' }
    }
  }
  const amountSum = rows.reduce((sum, row) => sum + (row.amountDue ?? 0), 0)
  if (amountSum > expenseAmount) {
    return { ok: false, error: `負担額の合計が支出金額を超えています(${amountSum - expenseAmount}円超過)` }
  }
  return {
    ok: true,
    rows: rows.map((row) => {
      const amountDue = row.amountDue ?? 0
      return { key: row.key, ratio: round2((amountDue / expenseAmount) * 100), amountDue }
    }),
  }
}
