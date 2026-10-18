import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Category, Store, InventoryItem } from '../../api/zaikoTypes'
import { validPrice, PRICE_ERROR } from './price'
import { useInventoryDialog } from './useInventoryDialog'

interface Props {
  item?: InventoryItem
  categories: Category[]
  stores: Store[]
  onStoresChange: (stores: Store[]) => void
  onClose: () => void
  onSaved: () => Promise<void>
}

export function InventoryModal({ item, categories, stores, onStoresChange, onClose, onSaved }: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState(String(item?.categoryId ?? categories[0]?.id ?? ''))
  const [storeId, setStoreId] = useState(item?.storeId == null ? '' : String(item.storeId))
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [threshold, setThreshold] = useState(String(item?.threshold ?? 0.5))
  const [price, setPrice] = useState(item?.price == null ? '' : String(item.price))
  const [storeFormOpen, setStoreFormOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const close = () => { if (!submitting) onClose() }
  const dialogRef = useInventoryDialog(close, '#inv-name')

  const handleAddStore = async () => {
    const trimmed = newStoreName.trim()
    if (!trimmed) {
      setError('店名を入力してください')
      return
    }
    setError('')
    try {
      const response = await apiClient.post<Store>('/stores', { name: trimmed })
      onStoresChange([...stores, response.data])
      setStoreId(String(response.data.id))
      setNewStoreName('')
      setStoreFormOpen(false)
    } catch (err) {
      setError(getApiErrorMessage(err, '店の登録に失敗しました'))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validPrice(price)) { setError(PRICE_ERROR); return }
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('品名は1〜50文字で入力してください')
      return
    }
    const trimmedQuantity = quantity.trim()
    const trimmedThreshold = threshold.trim()
    if (trimmedQuantity === '' || trimmedThreshold === '') {
      setError('在庫個数・閾値は0以上で入力してください')
      return
    }
    const quantityValue = Number(trimmedQuantity)
    const thresholdValue = Number(trimmedThreshold)
    if (Number.isNaN(quantityValue) || quantityValue < 0 || Number.isNaN(thresholdValue) || thresholdValue < 0) {
      setError('在庫個数・閾値は0以上で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const body = {
        name: trimmedName,
        categoryId: Number(categoryId),
        storeId: storeId === '' ? null : Number(storeId),
        threshold: thresholdValue,
        price: price.trim() === '' ? null : Number(price),
      }
      if (item) await apiClient.patch(`/inventory-items/${item.id}`, body)
      else await apiClient.post('/inventory-items', { ...body, quantity: quantityValue })
      await onSaved()
    } catch (err) {
      setError(getApiErrorMessage(err, item ? '在庫の編集に失敗しました' : '在庫の登録に失敗しました'))
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay inventory-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} className="modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">
        <h2 id="inventory-modal-title">{item ? '在庫を編集' : '在庫を登録'}</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="inv-name">品名</label>
          <input id="inv-name" type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="inv-category">カテゴリー</label>
          <select id="inv-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="inv-store">
            買う店（任意）{' '}
            <button type="button" className="btn btn-tiny" onClick={() => setStoreFormOpen((open) => !open)}>
              ＋店を登録
            </button>
          </label>
          <select id="inv-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">なし</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {storeFormOpen && (
            <div>
              <label htmlFor="store-name">店名</label>
              <input
                id="store-name"
                type="text"
                placeholder="例：スーパーC"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
              />
              <button type="button" className="btn btn-small" onClick={handleAddStore}>
                店を追加
              </button>
            </div>
          )}
          <label htmlFor="inv-quantity">在庫個数</label>
          <input
            id="inv-quantity"
            type="number"
            step="0.1"
            min="0"
            disabled={!!item}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          {item && <p className="hint">在庫個数は詳細の＋/－で変更できます</p>}
          <label htmlFor="inv-price">値段（円・任意）</label>
          <input id="inv-price" type="text" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label htmlFor="inv-threshold">買い物リスト追加閾値</label>
          <input
            id="inv-threshold"
            type="number"
            step="0.1"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <p className="hint">在庫個数がこの数以下になると、買い物リストに自動追加されます</p>
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              保存
            </button>
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={close}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
