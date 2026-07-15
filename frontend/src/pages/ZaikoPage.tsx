import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Category, InventoryItem, ShoppingListItem, ShoppingSort, Store } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'
import { InventoryPanel } from '../components/zaiko/InventoryPanel'
import { ShoppingListPanel } from '../components/zaiko/ShoppingListPanel'

export function ZaikoPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [shopping, setShopping] = useState<ShoppingListItem[]>([])
  const [sort, setSort] = useState<ShoppingSort>('name')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchInventory = useCallback(async () => {
    const response = await apiClient.get<InventoryItem[]>('/inventory-items')
    setInventory(response.data)
  }, [])

  const fetchShopping = useCallback(async (sortValue: ShoppingSort) => {
    const response = await apiClient.get<ShoppingListItem[]>('/shopping-list-items', {
      params: { sort: sortValue },
    })
    setShopping(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiClient.get<Category[]>('/zaiko-categories'),
      apiClient.get<Store[]>('/stores'),
      apiClient.get<InventoryItem[]>('/inventory-items'),
      apiClient.get<ShoppingListItem[]>('/shopping-list-items', { params: { sort: 'name' } }),
    ])
      .then(([categoriesRes, storesRes, inventoryRes, shoppingRes]) => {
        if (cancelled) return
        setCategories(categoriesRes.data)
        setStores(storesRes.data)
        setInventory(inventoryRes.data)
        setShopping(shoppingRes.data)
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

  const handleSortChange = async (nextSort: ShoppingSort) => {
    setSort(nextSort)
    try {
      await fetchShopping(nextSort)
    } catch (err) {
      showToast(getApiErrorMessage(err, '買い物リストの取得に失敗しました'))
    }
  }

  // 在庫の増減・登録後は買い物リストの自動追加/除外も反映するため両方再取得する
  const refreshAll = useCallback(async () => {
    await Promise.all([fetchInventory(), fetchShopping(sort)])
  }, [fetchInventory, fetchShopping, sort])

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page zaiko-page">
      <InventoryPanel
        inventory={inventory}
        categories={categories}
        stores={stores}
        onStoresChange={setStores}
        onRefresh={refreshAll}
        onNotify={showToast}
      />
      <ShoppingListPanel
        shopping={shopping}
        inventory={inventory}
        categories={categories}
        stores={stores}
        sort={sort}
        onSortChange={handleSortChange}
        onRefresh={refreshAll}
        onNotify={showToast}
      />
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
