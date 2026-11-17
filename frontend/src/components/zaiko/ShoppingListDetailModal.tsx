import type { ShoppingListItem } from '../../api/zaikoTypes'
import { formatPrice } from './price'
import { useInventoryDialog } from './useInventoryDialog'
interface Props {
  item: ShoppingListItem; category: string; store: string; stock: string
  plannedText: string; actualText: string; checked: boolean; busy: boolean; saving: boolean; error: string
  onPlanned: (text: string) => void; onActual: (text: string) => void; onSavePlanned: () => void
  onDelete: () => void; onClose: () => void
}
export function ShoppingListDetailModal({ item, category, store, stock, plannedText, actualText, checked, busy, saving, error, onPlanned, onActual, onSavePlanned, onDelete, onClose }: Props) {
  const ref = useInventoryDialog(onClose, '[data-shopping-close]')
  return <div className="modal-overlay inventory-modal-overlay" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="modal inventory-modal inventory-detail-modal shopping-detail-modal" role="dialog" aria-modal="true" aria-labelledby="shopping-detail-title">
      <div className="shopping-detail-heading">
        <h2 id="shopping-detail-title">買い物詳細</h2>
        <button type="button" className="btn btn-secondary shopping-detail-close" aria-label="買い物詳細を閉じる" data-shopping-close onClick={onClose}>×</button>
      </div>
      <dl>
        <dt>品名</dt>
        <dd>{item.name}</dd>
        <dt>カテゴリー</dt>
        <dd>{category}</dd>
        <dt>買う店</dt>
        <dd>{store || 'なし'}</dd>
        <dt>参考値段</dt>
        <dd>{formatPrice(item.price)}</dd>
        <dt>現在の在庫</dt>
        <dd>{stock}</dd>
      </dl>
      <label htmlFor="shopping-planned">予定数</label>
      <div className="shopping-planned-controls">
        <input id="shopping-planned" type="text" inputMode="decimal" aria-label={item.name + 'の予定数'} value={plannedText} disabled={busy || saving} onChange={e => onPlanned(e.target.value)} />
        <button className="btn btn-secondary" disabled={busy || saving} onClick={onSavePlanned}>予定数を保存</button>
      </div>
      <p className="hint">0.1〜99999.9、小数第一位まで。予定数を保存しても在庫は変わりません。</p>
      <label htmlFor="shopping-actual">実購入数</label>
      <input id="shopping-actual" type="text" inputMode="decimal" aria-label={item.name + 'の実購入数'} value={actualText} disabled={busy || saving || !checked} onChange={e => onActual(e.target.value)} />
      <p className="hint">{checked ? '0〜99999.9、小数第一位まで。0は購入に含めません。閉じても入力を保持します。' : '一覧で購入済みにチェックすると、予定数が実購入数の初期値になります。'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" disabled={busy || saving} aria-label={item.name + 'を削除'} onClick={onDelete}>削除</button>
        <button type="button" className="btn btn-secondary" data-close onClick={onClose}>閉じる</button>
      </div>
    </div>
  </div>
}
