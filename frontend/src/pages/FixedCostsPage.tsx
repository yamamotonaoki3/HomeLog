import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account, FixedCost } from '../api/kakeiboTypes'
import { getCurrentUserId } from '../api/tokenStorage'
import { Toast } from '../components/Toast'
import { FixedCostModal } from '../components/kakeibo/FixedCostModal'
import { FixedCostDetailModal, FixedCostDeleteModal } from '../components/kakeibo/FixedCostDetailModal'
import type { HouseholdMember } from '../components/kakeibo/SplitFields'

interface HouseholdMe {
  members: HouseholdMember[]
}

export function FixedCostsPage() {
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fixedCostsLoaded, setFixedCostsLoaded] = useState(false)
  const [modalTarget, setModalTarget] = useState<FixedCost | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'detail' | 'edit' | 'delete'>('detail')
  const origin = useRef<HTMLButtonElement | null>(null)
  const register = useRef<HTMLButtonElement>(null)
  const deleteOrigin = useRef<HTMLButtonElement | null>(null)
  const deleteReturnView = useRef<'detail' | 'edit'>('detail')
  const restoreDeleteFocus = useRef(false)
  const selected = fixedCosts.find((cost) => cost.id === selectedId)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchFixedCosts = useCallback(async () => {
    const response = await apiClient.get<FixedCost[]>('/fixed-costs')
    setFixedCosts(response.data)
    setFixedCostsLoaded(true)
  }, [])

  const paymentSourceName = useCallback(
    (fixedCost: FixedCost) => {
      if (!fixedCost.editable) return '非公開'
      if (fixedCost.accountId !== null) {
        return accounts.find((account) => account.id === fixedCost.accountId)?.name ?? '確認できません'
      }
      if (fixedCost.cardId !== null) {
        return accounts.flatMap((account) => account.cards).find((card) => card.id === fixedCost.cardId)?.name ?? '確認できません'
      }
      return 'なし'
    },
    [accounts],
  )

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchFixedCosts(), apiClient.get<Account[]>('/accounts')])
      .then(([fixedCostsResult, accountsResult]) => {
        if (cancelled) return
        if (fixedCostsResult.status === 'rejected') {
          showToast(
            getApiErrorMessage(fixedCostsResult.reason, '固定費の取得に失敗しました。時間をおいて再度お試しください'),
          )
        }
        if (accountsResult.status === 'fulfilled') {
          setAccounts(accountsResult.value.data)
        } else {
          showToast(getApiErrorMessage(accountsResult.reason, '口座の取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    apiClient
      .get<HouseholdMe>('/households/me')
      .then((response) => {
        // 割り勘の相手候補は「自分以外」の世帯メンバー。
        const myId = getCurrentUserId()
        if (cancelled) return
        setMembers(response.data.members.filter((member) => member.userId !== myId))
        // 取得成功時のみ「取得済み」とする。失敗時に空配列を「相手が全員退出」と誤判定しないため。
        setMembersLoaded(true)
      })
      .catch(() => {
        // 相手候補が取れないだけなので致命的ではない。
      })

    return () => {
      cancelled = true
    }
  }, [fetchFixedCosts, showToast])

  const closeDetail = useCallback(() => {
    setSelectedId(null)
    setView('detail')
    if (origin.current?.isConnected) origin.current.focus()
    else register.current?.focus()
  }, [])

  useEffect(() => {
    if (selectedId !== null && !selected) closeDetail()
  }, [selectedId, selected, closeDetail])

  useEffect(() => {
    if (view !== 'delete' && restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false
      deleteOrigin.current?.focus()
    }
  }, [view])

  const requestDelete = (trigger: HTMLButtonElement) => {
    deleteOrigin.current = trigger
    deleteReturnView.current = modalTarget != null ? 'edit' : 'detail'
    setView('delete')
  }
  const cancelDelete = () => {
    if (deleting) return
    restoreDeleteFocus.current = true
    setView(deleteReturnView.current)
  }

  const handleSaved = async (saved: FixedCost) => {
    const wasEdit = modalTarget != null
    setFixedCosts((prev) => [...prev.filter((cost) => cost.id !== saved.id), saved])
    try {
      await fetchFixedCosts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費一覧の取得に失敗しました'))
      return
    }
    setModalTarget(undefined)
    showToast(wasEdit ? '固定費を更新しました' : '固定費を登録しました')
  }

  const handleDelete = async () => {
    if (!selected || !selected.editable || deleting) return
    const deletedId = selected.id
    setDeleting(true)
    try {
      await apiClient.delete(`/fixed-costs/${deletedId}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費の削除に失敗しました'))
      setDeleting(false)
      restoreDeleteFocus.current = true
      setView(deleteReturnView.current)
      return
    }
    setFixedCosts((prev) => prev.filter((fixedCost) => fixedCost.id !== deletedId))
    setDeleting(false)
    setModalTarget(undefined)
    origin.current = null
    closeDetail()
    showToast('固定費を削除しました')
    try {
      await fetchFixedCosts()
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費一覧の取得に失敗しました'))
    }
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page fixed-cost-page">
      <div className="ui-narrow" data-testid="fixed-costs-panel">
        <header className="ui-page-head">
          <div>
            <h2>固定費管理</h2>
            <p className="ui-page-sub">毎月の支払予定を確認</p>
          </div>
        </header>
        <button ref={register} type="button" className="ui-action" onClick={() => setModalTarget(null)}>
          <span aria-hidden="true">＋</span>固定費を登録
        </button>
        <div className="kakeibo-links">
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
        </div>
        <p className="ui-note">固定費は、設定した毎月の支払日に家計簿の支出へ自動計上されます。ここに表示する金額は月額の予定です。</p>
        {!fixedCostsLoaded && <p role="status">固定費一覧を確認できません</p>}
        {fixedCosts.length === 0 ? (fixedCostsLoaded && (
          <div className="ui-card fixed-cost-empty">
            <h3>固定費はありません</h3>
            <p>家賃やサブスクリプションを登録すると、毎月の支払日に支出へ自動計上されます。</p>
            <button type="button" className="btn btn-secondary" onClick={() => setModalTarget(null)}>登録を始める</button>
          </div>
        )) : <>
        <h3 id="fixed-cost-list-title" className="ui-section-label">登録済みの固定費</h3>
        <ul className="fixed-cost-cards" aria-labelledby="fixed-cost-list-title">
          {fixedCosts.map((cost) => (
            <li key={cost.id} className="ui-card fixed-cost-card">
              <button type="button" className="list-row-button fixed-cost-grid" aria-label={`${cost.name}の詳細`} onClick={(event) => { origin.current = event.currentTarget; setSelectedId(cost.id); setView('detail') }}>
                <span>{cost.name}</span><span>{cost.amount.toLocaleString('ja-JP')}円</span><span>{cost.paymentDay}日</span><span>{paymentSourceName(cost)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ui-card fixed-cost-total" data-testid="fixed-cost-total">
          <p className="fixed-cost-total-main"><span>登録額合計（参考）</span><strong>{fixedCosts.reduce((sum, cost) => sum + cost.amount, 0).toLocaleString('ja-JP')}円</strong></p>
          <p className="fixed-cost-total-note">表示中の固定費の月額を足した金額です。支出へ自動計上済みの額と単純に合算しないでください。</p>
        </div></>}
      </div>
      {modalTarget !== undefined && (
        <FixedCostModal
          fixedCost={modalTarget}
          accounts={accounts}
          members={members}
          membersLoaded={membersLoaded}
          onClose={() => { setModalTarget(undefined); setView('detail'); if (!selectedId) register.current?.focus() }}
          onSaved={handleSaved}
          hidden={view === 'delete'}
          onDelete={modalTarget?.editable ? requestDelete : undefined}
        />
      )}
      {selected && <FixedCostDetailModal hidden={view !== 'detail' || modalTarget !== undefined} fixedCost={selected} paymentSource={paymentSourceName(selected)} members={members} membersLoaded={membersLoaded} onClose={closeDetail} onEdit={() => { setView('edit'); setModalTarget(selected) }} onDelete={requestDelete} />}
      {selected && view === 'delete' && <FixedCostDeleteModal name={selected.name} busy={deleting} onClose={cancelDelete} onDelete={handleDelete} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
