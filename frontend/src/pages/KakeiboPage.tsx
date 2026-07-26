import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Expense, KakeiboCategory } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { ExpenseListPanel } from '../components/kakeibo/ExpenseListPanel'
import { ExpenseModal } from '../components/kakeibo/ExpenseModal'

export function KakeiboPage() {
  const [categories, setCategories] = useState<KakeiboCategory[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const latestExpenseRequestId = useRef(0)

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchExpenses = useCallback(async (categoryIdFilter: string) => {
    const requestId = ++latestExpenseRequestId.current
    const response = await apiClient.get<Expense[]>('/expenses', {
      params: categoryIdFilter === '' ? {} : { categoryId: categoryIdFilter },
    })
    if (requestId === latestExpenseRequestId.current) {
      setExpenses(response.data)
      return true
    }
    return false
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiClient.get<KakeiboCategory[]>('/kakeibo-categories'),
      apiClient.get<Expense[]>('/expenses'),
    ])
      .then(([categoriesRes, expensesRes]) => {
        if (cancelled) return
        setCategories(categoriesRes.data)
        setExpenses(expensesRes.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          showToast(getApiErrorMessage(err, 'データの取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  const handleCategoryFilterChange = async (categoryId: string) => {
    try {
      const applied = await fetchExpenses(categoryId)
      if (applied) setCategoryFilter(categoryId)
    } catch (err) {
      showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
    }
  }

  const handleSaved = async () => {
    try {
      await fetchExpenses(categoryFilter)
    } catch (err) {
      showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
      throw err
    }
    setModalOpen(false)
    showToast('支出を登録しました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <ExpenseListPanel
        expenses={expenses}
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={handleCategoryFilterChange}
        onAddClick={() => setModalOpen(true)}
        addDisabled={categories.length === 0}
      />
      {modalOpen && (
        <ExpenseModal categories={categories} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
