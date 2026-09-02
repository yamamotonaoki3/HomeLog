// F-04 割り勘の負担額・負担割合の計算(docs/details/features/F04_kakeibo_warikan.md 7章)。
// ルート層から切り出した純粋関数。DB・認証には一切依存しない(テストしやすさのため)。

export type SplitInputType = 'ratio' | 'amount'

// 呼び出し側が参加者を識別するためのキー(userId/externalId等)をそのまま透過させる。
// この計算自体は「支払者か否か」だけを見る。
export interface SplitInputRow {
  key: string
  isPayer: boolean
  // ratio モードのとき使用(％)。
  ratio?: number | null
  // amount モードのとき使用(円)。
  amountDue?: number | null
}

export interface ResolvedSplitRow {
  key: string
  isPayer: boolean
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
 * 割り勘の入力(支払者を含む全参加者)を検証し、各参加者の負担割合・負担額を確定する。
 *
 * - ratio モード: 全参加者の割合合計が 100(±0.01)であること。負担額は floor(金額 × 割合 / 100)。
 *   端数(合計と支出金額の差)は行を持たない支払者へ寄せる。
 * - amount モード: 全参加者の負担額合計が支出金額と完全一致すること。割合は amount からの逆算(参考値)。
 */
export function resolveSplits(
  expenseAmount: number,
  inputType: SplitInputType,
  rows: SplitInputRow[],
): SplitCalcResult {
  if (!Number.isInteger(expenseAmount) || expenseAmount <= 0) {
    return { ok: false, error: '支出金額が不正です' }
  }

  const payerRows = rows.filter((row) => row.isPayer)
  const debtorRows = rows.filter((row) => !row.isPayer)
  if (payerRows.length !== 1) {
    return { ok: false, error: '支払者(自分)を1人だけ含めてください' }
  }
  if (debtorRows.length < 1) {
    return { ok: false, error: '割り勘の相手を1人以上指定してください' }
  }

  if (inputType === 'ratio') {
    for (const row of rows) {
      if (row.ratio == null || !Number.isFinite(row.ratio) || row.ratio < 0 || row.ratio > 100) {
        return { ok: false, error: '負担割合は0〜100%で入力してください' }
      }
    }
    const ratioSum = rows.reduce((sum, row) => sum + (row.ratio ?? 0), 0)
    if (Math.abs(ratioSum - 100) > RATIO_SUM_TOLERANCE) {
      return { ok: false, error: `負担割合の合計を100%にしてください(現在 ${round2(ratioSum)}%)` }
    }

    const debtorResolved = debtorRows.map((row) => {
      const ratio = row.ratio ?? 0
      return { key: row.key, isPayer: false, ratio: round2(ratio), amountDue: Math.floor((expenseAmount * ratio) / 100) }
    })
    const debtorTotal = debtorResolved.reduce((sum, row) => sum + row.amountDue, 0)
    if (debtorTotal > expenseAmount) {
      return { ok: false, error: '負担額の合計が支出金額を超えています' }
    }
    const payerRow = payerRows[0]
    const payerResolved = {
      key: payerRow.key,
      isPayer: true,
      ratio: round2(payerRow.ratio ?? 0),
      amountDue: expenseAmount - debtorTotal,
    }
    return { ok: true, rows: [payerResolved, ...debtorResolved] }
  }

  // amount モード
  for (const row of rows) {
    if (row.amountDue == null || !Number.isInteger(row.amountDue) || row.amountDue < 0) {
      return { ok: false, error: '負担額は0以上の整数で入力してください' }
    }
  }
  const amountSum = rows.reduce((sum, row) => sum + (row.amountDue ?? 0), 0)
  if (amountSum !== expenseAmount) {
    const diff = expenseAmount - amountSum
    const label = diff > 0 ? `${diff}円不足しています` : `${-diff}円多く入力されています`
    return { ok: false, error: `負担額の合計を支出金額に一致させてください(${label})` }
  }

  const resolved = rows.map((row) => {
    const amountDue = row.amountDue ?? 0
    return { key: row.key, isPayer: row.isPayer, ratio: round2((amountDue / expenseAmount) * 100), amountDue }
  })
  return { ok: true, rows: resolved }
}
