import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Account, AccountTransactionsResponse } from '../../api/kakeiboTypes'

interface Props {
  account: Account
  onClose: () => void
}

const TYPE_LABEL: Record<'expense' | 'income' | 'charge', string> = {
  expense: '支出',
  income: '収入',
  charge: 'チャージ',
}

/**
 * S-15 で口座名をクリックしたときに開く、その口座の取引履歴モーダル。
 * GET /api/accounts/:id/transactions の結果を日付降順のテーブルで表示する。
 */
export function AccountTransactionsModal({ account, onClose }: Props) {
  const [data, setData] = useState<AccountTransactionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return (
    <div className="modal-overlay">
      <div className="modal" data-testid="account-transactions-modal">
        <h2>
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
                <th>種別</th>
                <th>内容</th>
                <th>カテゴリー</th>
                <th>金額</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((tx) => (
                <tr key={`${tx.type}-${tx.id}`}>
                  <td>{tx.date}</td>
                  <td>{TYPE_LABEL[tx.type]}</td>
                  <td>{tx.description}</td>
                  <td>{tx.category ?? ''}</td>
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

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
