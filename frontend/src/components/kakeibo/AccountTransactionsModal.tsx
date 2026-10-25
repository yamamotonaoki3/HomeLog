import { useEffect, useRef, useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Account, AccountTransactionsResponse } from '../../api/kakeiboTypes'
import { useDialog } from '../../hooks/useDialog'

interface Props {
  account: Account
  onClose: () => void
  /** 削除が成功した後に呼ばれる。一覧の再取得に失敗した場合は reject する */
  onDeleted: (accountId: number) => Promise<void>
}

const TYPE_LABEL: Record<'expense' | 'income' | 'charge', string> = {
  expense: '支出',
  income: '収入',
  charge: 'チャージ',
}

type DeletePhase = 'idle' | 'confirm' | 'busy' | 'refresh-failed'

/**
 * S-15 で口座名をクリックしたときに開く、その口座の取引履歴モーダル。
 * GET /api/accounts/:id/transactions の結果を日付降順のテーブルで表示する。
 * 同じモーダル内で、履歴を残したまま口座を削除する二段階確認も行う(#371)。
 */
export function AccountTransactionsModal({ account, onClose, onDeleted }: Props) {
  const [data, setData] = useState<AccountTransactionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<DeletePhase>('idle')
  const [deleteError, setDeleteError] = useState('')
  const close = () => { if (phase !== 'busy') onClose() }
  const ref = useDialog(close, '[data-close]')
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const previousPhase = useRef<DeletePhase>('idle')

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<AccountTransactionsResponse>(`/accounts/${account.id}/transactions`)
      .then((response) => {
        if (!cancelled) setData(response.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err, '取引履歴の取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [account.id])

  // 確認の開始・取消でボタンが入れ替わるため、フォーカスを新しい操作の起点へ移す
  useEffect(() => {
    const dialog = ref.current
    if (phase === 'confirm' && previousPhase.current === 'idle') {
      dialog?.querySelector<HTMLElement>('[data-cancel]')?.focus({ preventScroll: true })
    } else if (phase === 'idle' && previousPhase.current === 'confirm') {
      deleteButtonRef.current?.focus({ preventScroll: true })
    } else if (phase === 'refresh-failed') {
      dialog?.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true })
    }
    previousPhase.current = phase
  }, [phase, ref])

  const handleDelete = async () => {
    if (phase !== 'confirm') return
    setPhase('busy')
    setDeleteError('')
    try {
      await apiClient.delete(`/accounts/${account.id}`)
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, '口座の削除に失敗しました。時間をおいて再度お試しください'))
      setPhase('confirm')
      return
    }
    // ここから先は削除済み。再取得の失敗を削除失敗と混同して再送させない
    try {
      await onDeleted(account.id)
    } catch {
      setPhase('refresh-failed')
    }
  }

  const confirming = phase === 'confirm' || phase === 'busy'

  return (
    <div className="modal-overlay">
      <div
        ref={ref}
        className="modal account-transactions-modal"
        data-testid="account-transactions-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-transactions-title"
      >
        <h2 id="account-transactions-title">
          {account.name} の取引履歴
          {data && <span>（残高: {data.currentBalance}円）</span>}
        </h2>

        {loading && <p>読み込み中...</p>}
        {!loading && error && <p className="error">{error}</p>}
        {!loading && !error && data && data.transactions.length === 0 && <p>取引はありません</p>}
        {!loading && !error && data && data.transactions.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>日付</th>
                <th>内容</th>
                <th>種別</th>
                <th>金額</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((tx) => (
                <tr key={`${tx.type}-${tx.id}`}>
                  <td>{tx.date}</td>
                  <td>{tx.description}</td>
                  <td>{TYPE_LABEL[tx.type]}</td>
                  <td>
                    {tx.direction === 'out' ? '-' : '+'}
                    {tx.amount}円
                  </td>
                  <td>{tx.balanceAfter}円</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {confirming && (
          <div className="account-delete-confirm">
            <p>
              「{account.name}」を削除します。取引履歴は残りますが、この口座は口座一覧・残高合計・新規入力の選択肢には表示されなくなります。
              この操作は取り消せません。
            </p>
          </div>
        )}
        {phase === 'refresh-failed' && (
          <p className="error" role="alert">
            削除は完了しました。ただし一覧の更新に失敗しました。ページを再読み込みして最新の状態を確認してください。
          </p>
        )}
        {deleteError && <p className="error" role="alert">{deleteError}</p>}

        <div className="modal-actions">
          {confirming ? (
            <>
              <button type="button" className="btn btn-danger" disabled={phase === 'busy'} onClick={handleDelete}>
                削除する
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                data-cancel
                disabled={phase === 'busy'}
                onClick={() => { setDeleteError(''); setPhase('idle') }}
              >
                キャンセル
              </button>
            </>
          ) : (
            phase === 'idle' && (
              <button
                ref={deleteButtonRef}
                type="button"
                className="btn btn-secondary"
                onClick={() => setPhase('confirm')}
              >
                口座を削除
              </button>
            )
          )}
          <button type="button" className="btn btn-secondary" data-close disabled={phase === 'busy'} onClick={close}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
