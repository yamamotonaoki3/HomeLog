import type { ShoppingListItem } from '../../api/zaikoTypes'
import { formatPrice } from './price'
import { useInventoryDialog } from './useInventoryDialog'

interface Props {
  item: ShoppingListItem
  category: string
  store: string
  quantity: number
  busy: boolean
  onQuantity: (quantity: number) => void
  onDelete: () => void
  onClose: () => void
}

export function ShoppingListDetailModal({ item, category, store, quantity, busy, onQuantity, onDelete, onClose }: Props) {
  const ref = useInventoryDialog(onClose, '[data-close]')
  return <div className="modal-overlay inventory-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="modal inventory-modal inventory-detail-modal" role="dialog" aria-modal="true" aria-labelledby="shopping-detail-title">
      <h2 id="shopping-detail-title">買い物詳細</h2>
      <dl>
        <dt>品名</dt><dd>{item.name}</dd>
        <dt>カテゴリー</dt><dd>{category}</dd>
        <dt>買う店</dt><dd>{store || 'なし'}</dd>
        <dt>参考値段</dt><dd>{formatPrice(item.price)}</dd>
        <dt>購入個数</dt><dd><div className="inventory-quantity-controls">
          <button type="button" className="btn btn-tiny" disabled={busy} aria-label={`${item.name}の購入個数を増やす`} onClick={() => onQuantity(quantity + 1)}>＋</button>
          <span className="qty-value">{quantity}</span>
          <button type="button" className="btn btn-tiny" disabled={busy} aria-label={`${item.name}の購入個数を減らす`} onClick={() => onQuantity(Math.max(0, quantity - 1))}>－</button>
        </div></dd>
      </dl>
      <p>購入個数は閉じても保持されます。一覧の「更新」で一括反映します。</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} aria-label={`${item.name}を削除`} onClick={onDelete}>削除</button>
        <button type="button" className="btn btn-secondary" data-close onClick={onClose}>閉じる</button>
      </div>
    </div>
  </div>
}
