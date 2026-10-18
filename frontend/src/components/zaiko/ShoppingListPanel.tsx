import { useEffect, useRef, useState } from 'react'
import { filterByKeyword } from '../../lib/keyword'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import { validPrice, PRICE_ERROR } from './price'
import { ShoppingListDetailModal } from './ShoppingListDetailModal'
import type { Category, InventoryItem, ShoppingListItem, ShoppingSort, Store } from '../../api/zaikoTypes'

interface Props {
  shopping: ShoppingListItem[]
  inventory: InventoryItem[]
  categories: Category[]
  stores: Store[]
  sort: ShoppingSort
  onSortChange: (sort: ShoppingSort) => void
  onRefresh: () => Promise<void>
  onNotify: (message: string) => void
}

interface PurchaseState {
  quantity: number
}

export function ShoppingListPanel({
  shopping,
  inventory,
  categories,
  stores,
  sort,
  onSortChange,
  onRefresh,
  onNotify,
}: Props) {
  const [keyword, setKeyword] = useState('')
  const [addFormOpen, setAddFormOpen] = useState(false)
  const [addItemId, setAddItemId] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [purchases, setPurchases] = useState<Record<number, PurchaseState>>({})
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const origin = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [selectedId, setSelectedId] = useState<number>()
  const selected = shopping.find((item) => item.id === selectedId)
  const closeDetail = () => {
    setSelectedId(undefined)
    ;(origin.current?.isConnected ? origin.current : addButton.current)?.focus()
  }
  useEffect(() => {
    if (selectedId !== undefined && !selected) {
      setSelectedId(undefined)
      addButton.current?.focus()
    }
    setPurchases((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => shopping.some((item) => item.id === Number(id)))))
  }, [shopping, selected, selectedId])

  const inventoryOf = (id: number) => inventory.find((i) => i.id === id)
  const categoryName = (id: number | undefined) =>
    id === undefined ? '' : (categories.find((c) => c.id === id)?.name ?? '')
  const storeName = (id: number | null | undefined) =>
    id === null || id === undefined ? '' : (stores.find((s) => s.id === id)?.name ?? '')

  const purchaseOf = (id: number): PurchaseState => purchases[id] ?? { quantity: 0 }

  const updatePurchase = (id: number, patch: Partial<PurchaseState>) => {
    setPurchases((prev) => ({ ...prev, [id]: { ...purchaseOf(id), ...prev[id], ...patch } }))
  }

  const handleManualAdd = async () => {
    if (!validPrice(addPrice)) { onNotify(PRICE_ERROR); return }
    if (addItemId === '') {
      return
    }
    try {
      await apiClient.post('/shopping-list-items', { inventoryItemId: Number(addItemId), ...(addPrice.trim() === '' ? {} : { price: Number(addPrice) }) })
      setAddFormOpen(false)
      setAddItemId('')
      setAddPrice('')
      await onRefresh()
    } catch (err) {
      onNotify(getApiErrorMessage(err, '買い物リストへの追加に失敗しました'))
    }
  }

  const handleDelete = async (item: ShoppingListItem) => {
    if (pending.current) return
    pending.current = true
    setSubmitting(true)
    try {
      await apiClient.delete(`/shopping-list-items/${item.id}`)
      setPurchases((previous) => { const next = { ...previous }; delete next[item.id]; return next })
      setSelectedId(undefined)
      addButton.current?.focus()
      try { await onRefresh() } catch { onNotify('削除しました。一覧の再取得に失敗しました') }
    } catch (err) {
      onNotify(getApiErrorMessage(err, '買い物リストからの削除に失敗しました'))
    } finally { pending.current = false; setSubmitting(false) }
  }

  const handleUpdate = async () => {
    if (pending.current) return
    const items = shopping
      .map((s) => ({ id: s.id, purchasedQuantity: purchaseOf(s.id).quantity }))
      .filter((line) => line.purchasedQuantity > 0)
    if (items.length === 0) {
      onNotify('購入個数を入力してください')
      return
    }
    pending.current = true
    setSubmitting(true)
    try {
      await apiClient.post('/shopping-list-items/update', { items })
      setPurchases({})
      try {
        await onRefresh()
        onNotify('在庫に反映しました')
      } catch { onNotify('在庫に反映しました。一覧の再取得に失敗しました') }
    } catch (err) {
      onNotify(getApiErrorMessage(err, '在庫への反映に失敗しました'))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  const visibleShopping = filterByKeyword(shopping, keyword, (item) => item.name)

  return (
    <div className="panel" data-testid="shopping-panel">
      <div className="toolbar">
        <h2>買い物リスト</h2>
        <select
          aria-label="並び替え"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as ShoppingSort)}
        >
          <option value="name">あいうえお順</option>
          <option value="category">カテゴリー順</option>
          <option value="store">買う店順</option>
        </select>
        <button ref={addButton} type="button" className="btn btn-secondary" onClick={() => setAddFormOpen((open) => !open)}>
          品目を手動追加
        </button>
      </div>
      {addFormOpen && (
        <div className="inline-form shopping-add-form">
          <select aria-label="追加する品目" value={addItemId} onChange={(e) => { setAddItemId(e.target.value); const price = inventoryOf(Number(e.target.value))?.price; setAddPrice(price == null ? '' : String(price)) }}>
            <option value="">選択してください</option>
            {inventory.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <label htmlFor="shopping-price">値段（円・任意）</label>
          <input id="shopping-price" type="text" inputMode="numeric" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={handleManualAdd}>
            追加
          </button>
        </div>
      )}
      <input type="search" className="zaiko-search" aria-label="キーワード検索" placeholder="キーワードで絞り込み" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <div aria-label="買い物リスト一覧">
        <div className="shopping-list-grid list-row-heading"><span>品名</span><span>買う店</span><span>購入個数</span></div>
        {shopping.length === 0 ? <p>買い物リストは空です</p> : visibleShopping.length === 0 ? <p>該当する品目がありません</p> : visibleShopping.map((item) => <button type="button" key={item.id} className="list-row-button shopping-list-grid" aria-label={`${item.name}の詳細`} onClick={(event) => { origin.current = event.currentTarget; setSelectedId(item.id) }}>
          <span>{item.name}</span><span>{storeName(inventoryOf(item.inventoryItemId)?.storeId) || 'なし'}</span><span>{purchaseOf(item.id).quantity}</span>
        </button>)}
      </div>
      {selected && <ShoppingListDetailModal item={selected} category={categoryName(inventoryOf(selected.inventoryItemId)?.categoryId)} store={storeName(inventoryOf(selected.inventoryItemId)?.storeId)} quantity={purchaseOf(selected.id).quantity} busy={submitting} onQuantity={(quantity) => { if (!pending.current) updatePurchase(selected.id, { quantity }) }} onDelete={() => { void handleDelete(selected) }} onClose={closeDetail} />}
      <button type="button" className="btn btn-primary" onClick={handleUpdate} disabled={submitting}>
        更新
      </button>
    </div>
  )
}
