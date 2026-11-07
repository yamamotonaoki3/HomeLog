import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account, Card } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { AccountModal } from '../components/kakeibo/AccountModal'
import { AccountTransactionsModal } from '../components/kakeibo/AccountTransactionsModal'
import { CardModal } from '../components/kakeibo/CardModal'
import { ChargeModal } from '../components/kakeibo/ChargeModal'

export function AccountsPage() {
  const [tab, setTab] = useState<'accounts' | 'cards'>('accounts')
  const [expanded, setExpanded] = useState<string[]>([])
  const modalTrigger = useRef<HTMLButtonElement | null>(null)
  const registration = useRef<HTMLButtonElement | null>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const restorePending = useRef(false)
  const toggle = (key: string) => setExpanded(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [cardModalOpen, setCardModalOpen] = useState(false)
  const [chargeTargetCard, setChargeTargetCard] = useState<Card | null>(null)
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const modalOpen = accountModalOpen || cardModalOpen || chargeTargetCard !== null || historyAccount !== null
  useLayoutEffect(() => {
    if (modalOpen || !restorePending.current) return
    restorePending.current = false
    const origin = modalTrigger.current
    const target = origin?.isConnected && !origin.matches(':disabled') ? origin
      : registration.current && !registration.current.disabled ? registration.current : tabs.current[tab === 'accounts' ? 0 : 1]
    target?.focus({ preventScroll: true })
  }, [modalOpen, tab])
  const closeAccount = () => { restorePending.current = true; setAccountModalOpen(false) }
  const closeCard = () => { restorePending.current = true; setCardModalOpen(false) }
  const closeCharge = () => { restorePending.current = true; setChargeTargetCard(null) }
  const closeHistory = () => { restorePending.current = true; setHistoryAccount(null) }
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tab === 'accounts' ? 0 : 1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
      : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1 - index : null
    if (next === null) return
    event.preventDefault()
    setTab(next === 0 ? 'accounts' : 'cards')
    tabs.current[next]?.focus()
  }

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
          setLoadError(true)
          showToast(getApiErrorMessage(err, '口座の取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchAccounts, showToast, loadAttempt])

  const handleAccountSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    showToast('口座を登録しました')
  }

  const handleCardSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    showToast('カードを登録しました')
  }

  const handleChargeSaved = async () => {
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    showToast('チャージしました')
  }

  // 削除済みの口座を画面に残さないよう、再取得の前に一覧から外しておく。
  // 再取得に失敗した場合は reject し、モーダル側が「削除は完了済み」として扱う。
  const handleAccountDeleted = async (accountId: number) => {
    setAccounts((prev) => prev.filter((account) => account.id !== accountId))
    try {
      await fetchAccounts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '口座一覧の取得に失敗しました'))
      throw err
    }
    closeHistory()
    showToast('口座を削除しました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  if (loadError) return <div className="page accounts-page"><div className="panel"><h2>口座・カード管理</h2><p role="alert" className="error">口座一覧を取得できませんでした</p><button type="button" className="btn btn-secondary" onClick={() => { setLoading(true); setLoadError(false); setLoadAttempt(value => value + 1) }}>再試行</button></div></div>

  const cards = accounts.flatMap(account => account.cards.map(card => ({ card, account })))
  return (
    <div className="page accounts-page">
      <div className="panel" data-testid="accounts-panel">
        <h2>口座・カード管理</h2>
        <div className="accounts-tabs" role="tablist" aria-label="口座とカード">
          {(['accounts', 'cards'] as const).map((value, index) => <button key={value} type="button" role="tab"
            id={'accounts-tab-' + value} aria-controls={'accounts-panel-' + value} aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1} ref={element => { tabs.current[index] = element }}
            onKeyDown={tabKeyDown} onClick={() => setTab(value)}>{value === 'accounts' ? '口座・財布' : 'カード'}</button>)}
        </div>
        <section role="tabpanel" id={'accounts-panel-' + tab} aria-labelledby={'accounts-tab-' + tab}>
          <div className="accounts-actions">
            {tab === 'accounts' ? <button ref={registration} type="button" className="btn btn-primary"
              onClick={event => { modalTrigger.current = event.currentTarget; setAccountModalOpen(true) }}>口座を登録</button>
              : <button ref={registration} type="button" className="btn btn-primary" disabled={accounts.length === 0}
                onClick={event => { modalTrigger.current = event.currentTarget; setCardModalOpen(true) }}>カードを登録</button>}
          </div>
          {tab === 'accounts' ? accounts.length === 0 ? <p>口座はありません</p> :
            <ul className="accounts-list" aria-label="口座一覧">{accounts.map(account => {
              const key = 'account:' + account.id
              const opened = expanded.includes(key)
              return <li key={account.id}>
                <button type="button" className="accounts-row" aria-label={account.name + 'の詳細'} aria-expanded={opened}
                  aria-controls={'account-detail-' + account.id} aria-describedby={'account-type-' + account.id + ' account-balance-' + account.id} onClick={() => toggle(key)}>
                  <span>{account.name}</span><span id={'account-type-' + account.id}>{account.type === 'bank' ? '銀行' : '電子マネー'}</span><span id={'account-balance-' + account.id}>{account.balance}円</span>
                </button>
                {!opened && <div id={'account-detail-' + account.id} hidden />}
                {opened && <div className="accounts-detail" id={'account-detail-' + account.id} role="region" aria-label={account.name + 'の詳細'}>
                  <p>紐づくカード</p>
                  {account.cards.length ? <ul className="accounts-card-list">{account.cards.map(card => <li key={card.id}>{card.name}（{card.cardType === 'charge' ? 'チャージ型カード' : 'クレジットカード'}）</li>)}</ul> : <p>なし</p>}
                  <button type="button" className="btn btn-secondary" onClick={event => { modalTrigger.current = event.currentTarget; setHistoryAccount(account) }}>{account.name}の取引履歴</button>
                </div>}
              </li>
            })}</ul>
            : <>
              {accounts.length === 0 && <div><p>カードを登録するには口座を登録してください</p><button type="button" className="btn btn-secondary" onClick={() => { modalTrigger.current = null; restorePending.current = true; setTab('accounts') }}>口座登録へ</button></div>}
              {cards.length === 0 ? <p>カードはありません</p> : <ul className="accounts-list" aria-label="カード一覧">{cards.map(({ card, account }) => {
                const key = 'card:' + card.id
                const opened = expanded.includes(key)
                return <li key={card.id}>
                  <button type="button" className="accounts-row accounts-card-row" aria-label={card.name + 'の詳細'} aria-expanded={opened}
                    aria-controls={'card-detail-' + card.id} aria-describedby={'card-type-' + card.id + ' card-account-' + card.id} onClick={() => toggle(key)}>
                    <span>{card.name}</span><span id={'card-type-' + card.id}>{card.cardType === 'charge' ? 'チャージ型カード' : 'クレジットカード'}</span><span id={'card-account-' + card.id}>{account.name}</span>
                  </button>
                  {!opened && <div id={'card-detail-' + card.id} hidden />}
                  {opened && <div className="accounts-detail" id={'card-detail-' + card.id} role="region" aria-label={card.name + 'の詳細'}>
                    <p>紐づく口座: {account.name}</p><p>種別: {card.cardType === 'charge' ? 'チャージ型カード' : 'クレジットカード'}</p>
                    {card.cardType === 'charge' && <><p>残高: {card.balance}円</p><button type="button" className="btn btn-secondary" onClick={event => { modalTrigger.current = event.currentTarget; setChargeTargetCard(card) }}>{card.name}にチャージ</button></>}
                  </div>}
                </li>
              })}</ul>}
            </>}
        </section>
        <section role="tabpanel" id={'accounts-panel-' + (tab === 'accounts' ? 'cards' : 'accounts')} aria-labelledby={'accounts-tab-' + (tab === 'accounts' ? 'cards' : 'accounts')} hidden />
      </div>
      {accountModalOpen && <AccountModal onClose={closeAccount} onSaved={handleAccountSaved} />}
      {cardModalOpen && <CardModal accounts={accounts} onClose={closeCard} onSaved={handleCardSaved} />}
      {chargeTargetCard && <ChargeModal card={chargeTargetCard} accounts={accounts} onClose={closeCharge} onSaved={handleChargeSaved} />}
      {historyAccount && <AccountTransactionsModal account={historyAccount} onClose={closeHistory} onDeleted={handleAccountDeleted} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
