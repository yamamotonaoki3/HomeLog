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
  const [modalTarget, setModalTarget] = useState<FixedCost | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'detail' | 'edit' | 'delete'>('detail')
  const origin = useRef<HTMLButtonElement | null>(null)
  const register = useRef<HTMLButtonElement>(null)
  const selected = fixedCosts.find((cost) => cost.id === selectedId)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchFixedCosts = useCallback(async () => {
    const response = await apiClient.get<FixedCost[]>('/fixed-costs')
    setFixedCosts(response.data)
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
    if (!selected || deleting) return
    const deletedId = selected.id
    setDeleting(true)
    try {
      await apiClient.delete(`/fixed-costs/${deletedId}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, '固定費の削除に失敗しました'))
      setDeleting(false)
      setView('detail')
      return
    }
    setFixedCosts((prev) => prev.filter((fixedCost) => fixedCost.id !== deletedId))
    setDeleting(false)
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
      <div className="panel" data-testid="fixed-costs-panel">
        <div className="toolbar">
          <h2>固定費管理</h2>
          <Link to="/kakeibo" className="btn btn-secondary">
            家計簿に戻る
          </Link>
          <button ref={register} type="button" className="btn btn-primary" onClick={() => setModalTarget(null)}>
            固定費を登録
          </button>
        </div>
        <div className="list-row-heading fixed-cost-grid"><span>固定費名</span><span>金額</span><span>支払日</span><span>引き落とし元</span></div>
        {fixedCosts.length === 0 ? <p>固定費はありません</p> : fixedCosts.map((cost) => (
          <button key={cost.id} type="button" className="list-row-button fixed-cost-grid" aria-label={`${cost.name}の詳細`} onClick={(event) => { origin.current = event.currentTarget; setSelectedId(cost.id); setView('detail') }}>
            <span>{cost.name}</span><span>{cost.amount}円</span><span>{cost.paymentDay}日</span><span>{paymentSourceName(cost)}</span>
          </button>
        ))}
      </div>
      {modalTarget !== undefined && (
        <FixedCostModal
          fixedCost={modalTarget}
          accounts={accounts}
          members={members}
          membersLoaded={membersLoaded}
          onClose={() => { setModalTarget(undefined); setView('detail'); if (!selectedId) register.current?.focus() }}
          onSaved={handleSaved}
        />
      )}
      {selected && view === 'detail' && modalTarget === undefined && <FixedCostDetailModal fixedCost={selected} paymentSource={paymentSourceName(selected)} members={members} membersLoaded={membersLoaded} onClose={closeDetail} onEdit={() => { setView('edit'); setModalTarget(selected) }} onDelete={() => setView('delete')} />}
      {selected && view === 'delete' && <FixedCostDeleteModal name={selected.name} busy={deleting} onClose={() => setView('detail')} onDelete={handleDelete} />}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
