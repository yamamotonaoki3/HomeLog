import { useEffect, useMemo, useState } from 'react'
import type { SplitInput } from '../../api/warikanTypes'

export interface HouseholdMember {
  userId: number
  displayName: string
}

export interface SplitFieldsResult {
  enabled: boolean
  valid: boolean
  splitInputType: 'ratio' | 'amount'
  splits: SplitInput[]
  errorMessage: string
}

export interface InitialSplit {
  debtorUserId: number
  ratio?: number
  amountDue?: number
}

interface Props {
  // 対象の金額(支出金額 or 固定費金額。負担額の計算・検証に使う)。未入力・不正なら 0。
  amount: number
  members: HouseholdMember[]
  onChange: (result: SplitFieldsResult) => void
  // false のとき「世帯外の人」を選べなくする(固定費の割り勘は世帯内メンバーのみ)。
  allowExternal?: boolean
  // 編集時の初期値。指定があれば割り勘を有効にした状態で開く。
  initialSplits?: InitialSplit[]
  initialSplitInputType?: 'ratio' | 'amount'
}

type RowKind = 'member' | 'external'

interface Row {
  key: number
  kind: RowKind
  memberId: string
  externalName: string
  // 入力モードに応じて「％」または「円」の文字列。
  value: string
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

let rowKeySeq = 1

function evenRatios(otherCount: number): number[] {
  // 自分を含めた人数で均等割りし、端数は自分(表示のみ)に残す。
  const per = round2(100 / (otherCount + 1))
  return Array.from({ length: otherCount }, () => per)
}

export function SplitFields({
  amount,
  members,
  onChange,
  allowExternal = true,
  initialSplits,
  initialSplitInputType,
}: Props) {
  const hasInitial = (initialSplits?.length ?? 0) > 0
  const [enabled, setEnabled] = useState(hasInitial)
  const [inputType, setInputType] = useState<'ratio' | 'amount'>(initialSplitInputType ?? 'ratio')
  const [rows, setRows] = useState<Row[]>(() =>
    (initialSplits ?? []).map((s) => ({
      key: rowKeySeq++,
      kind: 'member' as RowKind,
      memberId: String(s.debtorUserId),
      externalName: '',
      value: String((initialSplitInputType ?? 'ratio') === 'ratio' ? (s.ratio ?? '') : (s.amountDue ?? '')),
    })),
  )

  const addRow = () => {
    setRows((prev) => {
      const next: Row[] = [
        ...prev,
        { key: rowKeySeq++, kind: allowExternal && members.length === 0 ? 'external' : 'member', memberId: '', externalName: '', value: '' },
      ]
      if (inputType === 'ratio') {
        const ratios = evenRatios(next.length)
        next.forEach((row, index) => {
          row.value = String(ratios[index])
        })
      }
      return next
    })
  }

  const removeRow = (key: number) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.key !== key)
      if (inputType === 'ratio' && next.length > 0) {
        const ratios = evenRatios(next.length)
        next.forEach((row, index) => {
          row.value = String(ratios[index])
        })
      }
      return next
    })
  }

  const updateRow = (key: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const { result, myShareLabel } = useMemo(() => {
    if (!enabled) {
      return {
        result: { enabled: false, valid: true, splitInputType: inputType, splits: [], errorMessage: '' } as SplitFieldsResult,
        myShareLabel: '',
      }
    }

    const splits: SplitInput[] = []
    let othersTotal = 0
    let invalid = ''

    for (const row of rows) {
      const numeric = Number(row.value)
      if (row.value.trim() === '' || !Number.isFinite(numeric) || numeric < 0) {
        invalid = '割り勘の負担分を正しく入力してください'
      } else if (inputType === 'amount' && !Number.isInteger(numeric)) {
        invalid = '負担額は整数(円)で入力してください'
      } else if (inputType === 'ratio' && numeric > 100) {
        invalid = '負担割合は0〜100%で入力してください'
      }
      if (row.kind === 'member') {
        if (row.memberId === '') {
          invalid = '割り勘の相手(世帯メンバー)を選択してください'
        } else if (members.length > 0 && !members.some((m) => String(m.userId) === row.memberId)) {
          // 編集時の初期値に、その後世帯を退出したメンバーが含まれていた場合。選び直しを促す。
          invalid = '世帯を退出したメンバーが割り勘に含まれています。相手を選び直してください'
        } else {
          splits.push(
            inputType === 'ratio'
              ? { debtorUserId: Number(row.memberId), ratio: numeric }
              : { debtorUserId: Number(row.memberId), amountDue: numeric },
          )
        }
      } else {
        const name = row.externalName.trim()
        if (name === '') {
          invalid = '割り勘の相手(世帯外の人)の名前を入力してください'
        } else {
          splits.push(
            inputType === 'ratio'
              ? { debtorExternalName: name, ratio: numeric }
              : { debtorExternalName: name, amountDue: numeric },
          )
        }
      }
      othersTotal += Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
    }

    if (rows.length === 0) {
      invalid = '割り勘の相手を1人以上追加してください'
    }

    // 重複チェック(世帯メンバーの二重指定・同名の世帯外の人)。
    const seen = new Set<string>()
    for (const row of rows) {
      const id = row.kind === 'member' ? `m:${row.memberId}` : `e:${row.externalName.trim().toLowerCase()}`
      if (row.kind === 'member' ? row.memberId !== '' : row.externalName.trim() !== '') {
        if (seen.has(id)) invalid = '同じ相手を複数回指定することはできません'
        seen.add(id)
      }
    }

    let myShare = ''
    if (inputType === 'ratio') {
      if (othersTotal > 100.01) invalid = `負担割合の合計が100%を超えています(相手の合計 ${round2(othersTotal)}%)`
      myShare = `あなたの負担: ${round2(Math.max(0, 100 - othersTotal))}%`
    } else {
      if (amount > 0 && othersTotal > amount) invalid = `負担額の合計が金額を超えています(相手の合計 ${othersTotal}円)`
      myShare = amount > 0 ? `あなたの負担: ${Math.max(0, amount - othersTotal)}円` : ''
    }

    return {
      result: {
        enabled: true,
        valid: invalid === '',
        splitInputType: inputType,
        splits,
        errorMessage: invalid,
      } as SplitFieldsResult,
      myShareLabel: myShare,
    }
  }, [enabled, inputType, rows, amount, members])

  useEffect(() => {
    onChange(result)
  }, [result, onChange])

  const handleToggle = (checked: boolean) => {
    setEnabled(checked)
    if (checked && rows.length === 0) {
      setRows([
        {
          key: rowKeySeq++,
          kind: allowExternal && members.length === 0 ? 'external' : 'member',
          memberId: '',
          externalName: '',
          value: inputType === 'ratio' ? '50' : '',
        },
      ])
    }
  }

  const handleInputTypeChange = (next: 'ratio' | 'amount') => {
    setInputType(next)
    if (next === 'ratio') {
      const ratios = evenRatios(rows.length)
      setRows((prev) => prev.map((row, index) => ({ ...row, value: String(ratios[index] ?? '') })))
    } else {
      setRows((prev) => prev.map((row) => ({ ...row, value: '' })))
    }
  }

  return (
    <fieldset className="split-fields">
      <label htmlFor="tx-split-enabled">
        <input
          id="tx-split-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />{' '}
        割り勘する
      </label>

      {enabled && (
        <>
          <div className="tabs" role="tablist" aria-label="割り勘の入力方法">
            <button
              type="button"
              role="tab"
              aria-selected={inputType === 'ratio'}
              className={inputType === 'ratio' ? 'btn btn-primary btn-tiny' : 'btn btn-secondary btn-tiny'}
              onClick={() => handleInputTypeChange('ratio')}
            >
              ％入力
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputType === 'amount'}
              className={inputType === 'amount' ? 'btn btn-primary btn-tiny' : 'btn btn-secondary btn-tiny'}
              onClick={() => handleInputTypeChange('amount')}
            >
              金額入力
            </button>
          </div>

          <ul className="split-rows">
            {rows.map((row) => (
              <li key={row.key} className="split-row">
                {allowExternal && (
                  <select
                    aria-label="割り勘の相手の種別"
                    value={row.kind}
                    onChange={(e) => updateRow(row.key, { kind: e.target.value as RowKind })}
                  >
                    <option value="member">世帯メンバー</option>
                    <option value="external">世帯外の人</option>
                  </select>
                )}
                {row.kind === 'member' ? (
                  <select
                    aria-label="世帯メンバー"
                    value={row.memberId}
                    onChange={(e) => updateRow(row.key, { memberId: e.target.value })}
                  >
                    <option value="">選択してください</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label="世帯外の人の名前"
                    maxLength={50}
                    value={row.externalName}
                    onChange={(e) => updateRow(row.key, { externalName: e.target.value })}
                  />
                )}
                <input
                  type="number"
                  aria-label={inputType === 'ratio' ? '負担割合（％）' : '負担額（円）'}
                  min="0"
                  step={inputType === 'ratio' ? '0.01' : '1'}
                  value={row.value}
                  onChange={(e) => updateRow(row.key, { value: e.target.value })}
                />
                <span>{inputType === 'ratio' ? '%' : '円'}</span>
                <button type="button" className="btn btn-tiny" onClick={() => removeRow(row.key)}>
                  削除
                </button>
              </li>
            ))}
          </ul>

          <button type="button" className="btn btn-secondary btn-tiny" onClick={addRow}>
            相手を追加
          </button>

          {myShareLabel && <p className="hint">{myShareLabel}</p>}
          {result.errorMessage && <p className="error">{result.errorMessage}</p>}
        </>
      )}
    </fieldset>
  )
}
