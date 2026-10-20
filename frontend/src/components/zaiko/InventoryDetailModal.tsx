import type { InventoryItem } from '../../api/zaikoTypes'
import { formatPrice } from './price'
import { useInventoryDialog } from './useInventoryDialog'

interface Props {
  item: InventoryItem
  category: string
  store: string
  step: number
  busy: boolean
  onStep: (step: number) => void
  onAdjust: (sign: 1 | -1) => void
  onEdit: () => void
  onClose: () => void
}

export function InventoryDetailModal({ item, category, store, step, busy, onStep, onAdjust, onEdit, onClose }: Props) {
  const ref = useInventoryDialog(onClose, '[data-close]')
  return <div className="modal-overlay inventory-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="modal inventory-modal inventory-detail-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-detail-title">
      <h2 id="inventory-detail-title">在庫詳細</h2>
      <dl>
        <dt>品名</dt><dd>{item.name}</dd>
        <dt>カテゴリー</dt><dd>{category}</dd>
        <dt>買う店</dt><dd>{store || 'なし'}</dd>
        <dt>在庫数</dt><dd><div className="inventory-quantity-controls">
          <button type="button" className="btn btn-tiny" disabled={busy} aria-label={`${item.name}を増やす`} onClick={() => onAdjust(1)}>＋</button>
          <span className="qty-value">{item.quantity.toFixed(1)}</span>
          <button type="button" className="btn btn-tiny" disabled={busy} aria-label={`${item.name}を減らす`} onClick={() => onAdjust(-1)}>－</button>
          <select className="step-select" disabled={busy} aria-label={`${item.name}の増減ステップ`} value={String(step)} onChange={(event) => onStep(Number(event.target.value))}><option value="1">1</option><option value="0.1">0.1</option></select>
        </div></dd>
        <dt>自動消費</dt><dd>{item.dailyConsumption == null ? '未設定' : `${item.dailyConsumption.toFixed(1)}／日・${item.autoConsumptionEnabled ? 'オン' : 'オフ'}`}</dd>
        <dt>閾値</dt><dd>{item.threshold.toFixed(1)}</dd>
        <dt>値段</dt><dd>{formatPrice(item.price)}</dd>
      </dl>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" disabled={busy} aria-label={`${item.name}を編集`} onClick={onEdit}>編集</button>
        <button type="button" className="btn btn-secondary" data-close onClick={onClose}>閉じる</button>
      </div>
    </div>
  </div>
}
