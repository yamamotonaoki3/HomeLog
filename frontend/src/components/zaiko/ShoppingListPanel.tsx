import { useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
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
  const [addFormOpen, setAddFormOpen] = useState(false)
  const [addItemId, setAddItemId] = useState('')
  const [purchases, setPurchases] = useState<Record<number, PurchaseState>>({})
  const [submitting, setSubmitting] = useState(false)

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
    if (addItemId === '') {
      return
    }
    try {
      await apiClient.post('/shopping-list-items', { inventoryItemId: Number(addItemId) })
      setAddFormOpen(false)
      await onRefresh()
    } catch (err) {
      onNotify(getApiErrorMessage(err, '買い物リストへの追加に失敗しました'))
    }
  }

  const handleDelete = async (item: ShoppingListItem) => {
    try {
      await apiClient.delete(`/shopping-list-items/${item.id}`)
      await onRefresh()
    } catch (err) {
      onNotify(getApiErrorMessage(err, '買い物リストからの削除に失敗しました'))
    }
  }

  const handleUpdate = async () => {
    const items = shopping
      .map((s) => ({ id: s.id, purchasedQuantity: purchaseOf(s.id).quantity }))
      .filter((line) => line.purchasedQuantity > 0)
    if (items.length === 0) {
      onNotify('購入個数を入力してください')
      return
    }
    setSubmitting(true)
    try {
      await apiClient.post('/shopping-list-items/update', { items })
      setPurchases({})
      await onRefresh()
      onNotify('在庫に反映しました')
    } catch (err) {
      onNotify(getApiErrorMessage(err, '在庫への反映に失敗しました'))
    } finally {
      setSubmitting(false)
    }
  }

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
        <button type="button" className="btn btn-secondary" onClick={() => setAddFormOpen((open) => !open)}>
          品目を手動追加
        </button>
      </div>
      {addFormOpen && (
        <div className="inline-form">
          <select aria-label="追加する品目" value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
            <option value="">選択してください</option>
            {inventory.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={handleManualAdd}>
            追加
          </button>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>品名</th>
            <th>カテゴリー</th>
            <th>買う店</th>
            <th>購入個数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shopping.length === 0 ? (
            <tr>
              <td colSpan={5}>買い物リストは空です</td>
            </tr>
          ) : (
            shopping.map((item) => {
              const inv = inventoryOf(item.inventoryItemId)
              const purchase = purchaseOf(item.id)
              return (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{categoryName(inv?.categoryId)}</td>
                  <td>{storeName(inv?.storeId)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      aria-label={`${item.name}の購入個数を減らす`}
                      onClick={() => updatePurchase(item.id, { quantity: Math.max(0, purchase.quantity - 1) })}
                    >
                      －
                    </button>
                    <span className="qty-value">{purchase.quantity}</span>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      aria-label={`${item.name}の購入個数を増やす`}
                      onClick={() => updatePurchase(item.id, { quantity: purchase.quantity + 1 })}
                    >
                      ＋
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      aria-label={`${item.name}を削除`}
                      onClick={() => handleDelete(item)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      <button type="button" className="btn btn-primary" onClick={handleUpdate} disabled={submitting}>
        更新
      </button>
    </div>
  )
}
