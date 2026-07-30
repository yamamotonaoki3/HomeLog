import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Account, Expense, Income, IncomeCategory, KakeiboCategory } from '../api/kakeiboTypes'
import { Toast } from '../components/Toast'
import { TransactionListPanel } from '../components/kakeibo/TransactionListPanel'
import { TransactionModal } from '../components/kakeibo/TransactionModal'

type TypeFilter = 'all' | 'expense' | 'income'

export function KakeiboPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const [categories, setCategories] = useState<KakeiboCategory[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const latestExpenseRequestId = useRef(0)

  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([])
  const [incomes, setIncomes] = useState<Income[]>([])
  const [incomeCategoryFilter, setIncomeCategoryFilter] = useState('')
  const latestIncomeRequestId = useRef(0)

  const [accounts, setAccounts] = useState<Account[]>([])

  const [modalOpen, setModalOpen] = useState(false)

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

    apiClient
      .get<Account[]>('/accounts')
      .then((response) => {
        if (!cancelled) setAccounts(response.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          showToast(getApiErrorMessage(err, '口座の取得に失敗しました。時間をおいて再度お試しください'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [showToast])

  const handleTypeFilterChange = async (nextTypeFilter: TypeFilter) => {
    setTypeFilter(nextTypeFilter)
    if (nextTypeFilter !== 'all') return

    if (categoryFilter !== '') {
      setCategoryFilter('')
      try {
        await fetchExpenses('')
      } catch (err) {
        showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
      }
    }
    if (incomeCategoryFilter !== '') {
      setIncomeCategoryFilter('')
      try {
        await fetchIncomes('')
      } catch (err) {
        showToast(getApiErrorMessage(err, '収入の取得に失敗しました'))
      }
    }
  }

  const handleActiveCategoryFilterChange = async (categoryIdValue: string) => {
    if (typeFilter === 'income') {
      try {
        const applied = await fetchIncomes(categoryIdValue)
        if (applied) setIncomeCategoryFilter(categoryIdValue)
      } catch (err) {
        showToast(getApiErrorMessage(err, '収入の取得に失敗しました'))
      }
      return
    }
    try {
      const applied = await fetchExpenses(categoryIdValue)
      if (applied) setCategoryFilter(categoryIdValue)
    } catch (err) {
      showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
    }
  }

  const handleSaved = async (kind: 'expense' | 'income') => {
    if (kind === 'expense') {
      try {
        await fetchExpenses(categoryFilter)
      } catch (err) {
        showToast(getApiErrorMessage(err, '支出の取得に失敗しました'))
        throw err
      }
      setModalOpen(false)
      showToast('支出を登録しました')
      return
    }
    try {
      await fetchIncomes(incomeCategoryFilter)
    } catch (err) {
      showToast(getApiErrorMessage(err, '収入の取得に失敗しました'))
      throw err
    }
    setModalOpen(false)
    showToast('収入を登録しました')
  }

  const loading =
    typeFilter === 'income' ? incomeLoading : typeFilter === 'expense' ? expenseLoading : expenseLoading || incomeLoading

  if (loading) {
    return <p>読み込み中...</p>
  }

  const initialKind = typeFilter === 'income' ? 'income' : 'expense'
  const activeCategoryFilter = typeFilter === 'income' ? incomeCategoryFilter : categoryFilter
  const activeCategoryOptions = typeFilter === 'income' ? incomeCategories : categories
  const addDisabled = categories.length === 0 && incomeCategories.length === 0

  return (
    <div className="page">
      <TransactionListPanel
        expenses={expenses}
        incomes={incomes}
        expenseCategories={categories}
        incomeCategories={incomeCategories}
        accounts={accounts}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
        activeCategoryFilter={activeCategoryFilter}
        activeCategoryOptions={activeCategoryOptions}
        onActiveCategoryFilterChange={handleActiveCategoryFilterChange}
        onAddClick={() => setModalOpen(true)}
        addDisabled={addDisabled}
      />
      {modalOpen && (
        <TransactionModal
          expenseCategories={categories}
          incomeCategories={incomeCategories}
          accounts={accounts}
          initialKind={initialKind}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
