import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account, Card } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { AccountModal } from '../components/kakeibo/AccountModal'
import { AccountTransactionsModal } from '../components/kakeibo/AccountTransactionsModal'
import { CardModal } from '../components/kakeibo/CardModal'
import { ChargeModal } from '../components/kakeibo/ChargeModal'

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [cardModalOpen, setCardModalOpen] = useState(false)
  const [chargeTargetCard, setChargeTargetCard] = useState<Card | null>(null)
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchAccounts = useCallback(async () => {
    const response = await apiClient.get<Account[]>('/accounts')
    setAccounts(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAccounts()
      .catch((err: unknown) => {
        if (!cancelled) {
          showToast(getApiErrorMessage(err, '口座の取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchAccounts, showToast])

  const handleAccountSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    setAccountModalOpen(false)
    showToast('口座を登録しました')
  }

  const handleCardSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    setCardModalOpen(false)
    showToast('カードを登録しました')
  }

  const handleChargeSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    setChargeTargetCard(null)
    showToast('チャージしました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="accounts-panel">
        <div className="toolbar">
          <h2>口座・カード管理</h2>
          <button type="button" className="btn btn-primary" onClick={() => setAccountModalOpen(true)}>
            口座を登録
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCardModalOpen(true)}
            disabled={accounts.length === 0}
          >
            カードを登録
          </button>
        </div>
        {accounts.length === 0 ? (
          <p>口座はありません</p>
        ) : (
          <ul>
            {accounts.map((account) => (
              <li key={account.id}>
                <button type="button" className="link-button" onClick={() => setHistoryAccount(account)}>
                  {account.name}
                </button>
                （{account.type === 'bank' ? '銀行' : '電子マネー'}） 残高: {account.balance}円
                {account.cards.length > 0 && (
                  <ul>
                    {account.cards.map((card) =>
                      card.cardType === 'charge' ? (
                        <li key={card.id}>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setChargeTargetCard(card)}
                          >
                            {card.name}（チャージ型） 残高: {card.balance}円
                          </button>
                        </li>
                      ) : (
                        <li key={card.id}>{card.name}</li>
                      ),
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {accountModalOpen && (
        <AccountModal onClose={() => setAccountModalOpen(false)} onSaved={handleAccountSaved} />
      )}
      {cardModalOpen && (
        <CardModal accounts={accounts} onClose={() => setCardModalOpen(false)} onSaved={handleCardSaved} />
      )}
      {chargeTargetCard && (
        <ChargeModal
          card={chargeTargetCard}
          accounts={accounts}
          onClose={() => setChargeTargetCard(null)}
          onSaved={handleChargeSaved}
        />
      )}
      {historyAccount && (
        <AccountTransactionsModal account={historyAccount} onClose={() => setHistoryAccount(null)} />
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
