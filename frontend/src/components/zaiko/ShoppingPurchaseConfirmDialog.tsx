import { useDialog } from '../../hooks/useDialog'
import type { PurchaseLine } from '../../lib/shoppingPending'
interface Props { lines: (PurchaseLine & { name: string })[]; busy: boolean; onConfirm: () => void; onClose: () => void }
export function ShoppingPurchaseConfirmDialog({ lines, busy, onConfirm, onClose }: Props) {
  const ref = useDialog(onClose, '[data-cancel]')
  return <div className="modal-overlay inventory-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} className="modal inventory-modal shopping-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="shopping-confirm-title">
      <h2 id="shopping-confirm-title">購入内容の確認</h2>
      <p>次の実購入数を在庫に加算します。</p>
      <ul>{lines.map(line => <li key={line.id}>
        <span>{line.name}</span>
        <strong>{line.purchasedQuantity}</strong>
      </li>)}</ul>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" data-cancel onClick={onClose}>戻る</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>この内容で購入を反映</button>
      </div>
    </div>
  </div>
}
