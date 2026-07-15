import { useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Category, InventoryItem, Store } from '../../api/zaikoTypes'
import { InventoryModal } from './InventoryModal'

interface Props {
  inventory: InventoryItem[]
  categories: Category[]
  stores: Store[]
  onStoresChange: (stores: Store[]) => void
  onRefresh: () => Promise<void>
  onNotify: (message: string) => void
}

export function InventoryPanel({ inventory, categories, stores, onStoresChange, onRefresh, onNotify }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [steps, setSteps] = useState<Record<number, number>>({})

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''
  const storeName = (id: number | null) => (id === null ? '' : (stores.find((s) => s.id === id)?.name ?? ''))

  const adjustQuantity = async (item: InventoryItem, sign: 1 | -1) => {
    const step = steps[item.id] ?? 1
    const delta = sign * step
    if (item.quantity + delta < 0) {
      onNotify('在庫個数は0未満にできません')
      return
    }
    try {
      await apiClient.patch(`/inventory-items/${item.id}/quantity`, { delta })
      await onRefresh()
    } catch (err) {
      onNotify(getApiErrorMessage(err, '在庫個数の更新に失敗しました'))
    }
  }

  return (
    <div className="panel" data-testid="inventory-panel">
      <div className="toolbar">
        <h2>在庫一覧</h2>
        <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
          在庫を登録
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>品名</th>
            <th>カテゴリー</th>
            <th>買う店</th>
            <th>在庫個数</th>
            <th>閾値</th>
          </tr>
        </thead>
        <tbody>
          {inventory.length === 0 ? (
            <tr>
              <td colSpan={5}>在庫がありません</td>
            </tr>
          ) : (
            inventory.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{categoryName(item.categoryId)}</td>
                <td>{storeName(item.storeId)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    aria-label={`${item.name}を減らす`}
                    onClick={() => adjustQuantity(item, -1)}
                  >
                    －
                  </button>
                  <span className="qty-value">{item.quantity.toFixed(1)}</span>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    aria-label={`${item.name}を増やす`}
                    onClick={() => adjustQuantity(item, 1)}
                  >
                    ＋
                  </button>
                  <select
                    className="step-select"
                    aria-label={`${item.name}の増減ステップ`}
                    value={String(steps[item.id] ?? 1)}
                    onChange={(e) => setSteps((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                  >
                    <option value="1">1</option>
                    <option value="0.1">0.1</option>
                  </select>
                </td>
                <td>{item.threshold.toFixed(1)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {modalOpen && (
        <InventoryModal
          categories={categories}
          stores={stores}
          onStoresChange={onStoresChange}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false)
            await onRefresh()
            onNotify('在庫を登録しました')
          }}
        />
      )}
    </div>
  )
}
