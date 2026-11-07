import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthContext } from '../context/authContextValue'
import { captureCredentials } from '../api/shoppingPurchases'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Category, InventoryItem, ShoppingListItem, ShoppingSort, Store } from '../api/zaikoTypes'
import { Toast } from '../components/Toast'
import { InventoryPanel } from '../components/zaiko/InventoryPanel'
import { ShoppingListPanel } from '../components/zaiko/ShoppingListPanel'

export function ZaikoPage() {
  // 上部タブ(AppLayout)の選択はURLで表す。/zaiko=在庫一覧、/zaiko/shopping=買い物リスト
  const auth = useContext(AuthContext)
  const shoppingGeneration = useRef(0), inventoryGeneration = useRef(0)
  const currentCredentials = (snapshot: ReturnType<typeof captureCredentials>) => {
    const current = captureCredentials()
    return snapshot ? current?.refreshToken === snapshot.refreshToken : current === null
  }
  const isShoppingTab = useLocation().pathname.startsWith('/zaiko/shopping')
  const [categories, setCategories] = useState<Category[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [shopping, setShopping] = useState<ShoppingListItem[]>([])
  const [sort, setSort] = useState<ShoppingSort>('store')
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchInventory = useCallback(async () => {
    const generation = ++inventoryGeneration.current, snapshot = captureCredentials()
    const response = await apiClient.get<InventoryItem[]>('/inventory-items')
    if (generation === inventoryGeneration.current && currentCredentials(snapshot)) setInventory(response.data)
  }, [])

  const fetchShopping = useCallback(async (sortValue: ShoppingSort) => {
    const generation = ++shoppingGeneration.current, snapshot = captureCredentials()
    const response = await apiClient.get<ShoppingListItem[]>('/shopping-list-items', {
      params: { sort: sortValue },
    })
    if (generation === shoppingGeneration.current && currentCredentials(snapshot)) setShopping(response.data)
  }, [])

  useEffect(() => {
    setLoading(true); setInitialError('')
    let cancelled = false
    const snapshot = captureCredentials(), shoppingRequest = ++shoppingGeneration.current, inventoryRequest = ++inventoryGeneration.current
    Promise.all([
      apiClient.get<Category[]>('/zaiko-categories'),
      apiClient.get<Store[]>('/stores'),
      apiClient.get<InventoryItem[]>('/inventory-items'),
      apiClient.get<ShoppingListItem[]>('/shopping-list-items', { params: { sort: 'store' } }),
    ])
      .then(([categoriesRes, storesRes, inventoryRes, shoppingRes]) => {
        if (cancelled || !currentCredentials(snapshot)) return
        setCategories(categoriesRes.data)
        setStores(storesRes.data)
        if (inventoryRequest === inventoryGeneration.current) setInventory(inventoryRes.data)
        if (shoppingRequest === shoppingGeneration.current) setShopping(shoppingRes.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setInitialError(getApiErrorMessage(err, 'データの取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showToast, loadAttempt])

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

  if (initialError) return <div className="page zaiko-page"><p role="alert">{initialError}</p><button type="button" className="btn btn-secondary" onClick={() => setLoadAttempt(value => value + 1)}>再取得</button></div>

  return (
    <div className="page zaiko-page">
      {/* 入力途中の購入個数などパネル内の状態を失わないよう、両パネルとも描画したまま非選択側を隠す */}
      <div hidden={isShoppingTab}>
        <InventoryPanel
          inventory={inventory}
          categories={categories}
          onCategoriesChange={setCategories}
          stores={stores}
          onStoresChange={setStores}
          onRefresh={refreshAll}
          onNotify={showToast}
        />
      </div>
      <div hidden={!isShoppingTab}>
        <ShoppingListPanel
          actorUserId={auth?.user?.id}
          active={isShoppingTab}
          shopping={shopping}
          inventory={inventory}
          categories={categories}
          stores={stores}
          sort={sort}
          onSortChange={handleSortChange}
          onRefresh={refreshAll}
          onNotify={showToast}
        />
      </div>
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
