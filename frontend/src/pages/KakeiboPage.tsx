import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Expense, Income, IncomeCategory, KakeiboCategory } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { ExpenseListPanel } from '../components/kakeibo/ExpenseListPanel'
import { ExpenseModal } from '../components/kakeibo/ExpenseModal'
import { IncomeListPanel } from '../components/kakeibo/IncomeListPanel'
import { IncomeModal } from '../components/kakeibo/IncomeModal'

type Tab = 'expense' | 'income'

export function KakeiboPage() {
  const [tab, setTab] = useState<Tab>('expense')

  const [categories, setCategories] = useState<KakeiboCategory[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const latestExpenseRequestId = useRef(0)

  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([])
  const [incomes, setIncomes] = useState<Income[]>([])
  const [incomeCategoryFilter, setIncomeCategoryFilter] = useState('')
  const [incomeModalOpen, setIncomeModalOpen] = useState(false)
  const latestIncomeRequestId = useRef(0)

  const [expenseLoading, setExpenseLoading] = useState(true)
  const [incomeLoading, setIncomeLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

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

  const fetchIncomes = useCallback(async (categoryIdFilter: string) => {
    const requestId = ++latestIncomeRequestId.current
    const response = await apiClient.get<Income[]>('/incomes', {
      params: categoryIdFilter === '' ? {} : { categoryId: categoryIdFilter },
    })
    if (requestId === latestIncomeRequestId.current) {
      setIncomes(response.data)
      return true
    }
    return false
  }, [])

  useEffect(() => {
    let cancelled = false
    const expenseRequestId = ++latestExpenseRequestId.current
    const incomeRequestId = ++latestIncomeRequestId.current

    Promise.allSettled([
      apiClient.get<KakeiboCategory[]>('/kakeibo-categories'),
      apiClient.get<Expense[]>('/expenses'),
    ])
      .then(([categoriesResult, expensesResult]) => {
        if (cancelled) return

        if (categoriesResult.status === 'fulfilled') {
          setCategories(categoriesResult.value.data)
        } else {
          showToast(
            getApiErrorMessage(
              categoriesResult.reason,
              'カテゴリーの取得に失敗しました。時間をおいて再度お試しください',
            ),
          )
        }

        if (
          expensesResult.status === 'fulfilled' &&
          expenseRequestId === latestExpenseRequestId.current
        ) {
          setExpenses(expensesResult.value.data)
        } else {
          if (expensesResult.status === 'rejected') {
            showToast(
              getApiErrorMessage(
                expensesResult.reason,
                '支出の取得に失敗しました。時間をおいて再度お試しください',
              ),
            )
          }
        }
      })
      .finally(() => {
        if (!cancelled) setExpenseLoading(false)
      })

    Promise.allSettled([
      apiClient.get<IncomeCategory[]>('/income-categories'),
      apiClient.get<Income[]>('/incomes'),
    ])
      .then(([incomeCategoriesResult, incomesResult]) => {
        if (cancelled) return

        if (incomeCategoriesResult.status === 'fulfilled') {
          setIncomeCategories(incomeCategoriesResult.value.data)
        } else {
          showToast(
            getApiErrorMessage(
              incomeCategoriesResult.reason,
              '収入カテゴリーの取得に失敗しました。時間をおいて再度お試しください',
            ),
          )
        }

        if (
          incomesResult.status === 'fulfilled' &&
          incomeRequestId === latestIncomeRequestId.current
        ) {
          setIncomes(incomesResult.value.data)
        } else {
          if (incomesResult.status === 'rejected') {
            showToast(
              getApiErrorMessage(
                incomesResult.reason,
                '収入の取得に失敗しました。時間をおいて再度お試しください',
              ),
            )
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIncomeLoading(false)
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

  const handleExpenseSaved = async () => {
    try {
      await fetchExpenses(categoryFilter)
    } catch (err) {
      showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
      throw err
    }
    setExpenseModalOpen(false)
    showToast('支出を登録しました')
  }

  const handleIncomeCategoryFilterChange = async (categoryId: string) => {
    try {
      const applied = await fetchIncomes(categoryId)
      if (applied) setIncomeCategoryFilter(categoryId)
    } catch (err) {
      showToast(getApiErrorMessage(err, '収入の取得に失敗しました'))
    }
  }

  const handleIncomeSaved = async () => {
    try {
      await fetchIncomes(incomeCategoryFilter)
    } catch (err) {
      showToast(getApiErrorMessage(err, '収入の取得に失敗しました'))
      throw err
    }
    setIncomeModalOpen(false)
    showToast('収入を登録しました')
  }

  return (
    <div className="page">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'expense'}
          className={tab === 'expense' ? 'tab is-active' : 'tab'}
          onClick={() => setTab('expense')}
        >
          支出
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'income'}
          className={tab === 'income' ? 'tab is-active' : 'tab'}
          onClick={() => setTab('income')}
        >
          収入
        </button>
      </div>
      {tab === 'expense' && expenseLoading ? (
        <p>読み込み中...</p>
      ) : tab === 'income' && incomeLoading ? (
        <p>読み込み中...</p>
      ) : tab === 'expense' ? (
        <>
          <ExpenseListPanel
            expenses={expenses}
            categories={categories}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={handleCategoryFilterChange}
            onAddClick={() => setExpenseModalOpen(true)}
            addDisabled={categories.length === 0}
          />
          {expenseModalOpen && (
            <ExpenseModal
              categories={categories}
              onClose={() => setExpenseModalOpen(false)}
              onSaved={handleExpenseSaved}
            />
          )}
        </>
      ) : (
        <>
          <IncomeListPanel
            incomes={incomes}
            categories={incomeCategories}
            categoryFilter={incomeCategoryFilter}
            onCategoryFilterChange={handleIncomeCategoryFilterChange}
            onAddClick={() => setIncomeModalOpen(true)}
            addDisabled={incomeCategories.length === 0}
          />
          {incomeModalOpen && (
            <IncomeModal
              categories={incomeCategories}
              onClose={() => setIncomeModalOpen(false)}
              onSaved={handleIncomeSaved}
            />
          )}
        </>
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
