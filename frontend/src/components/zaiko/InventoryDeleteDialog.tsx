import { useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { InventoryItem } from '../../api/zaikoTypes'
import { useDialog } from '../../hooks/useDialog'

interface Props {
  item: InventoryItem
  onClose: () => void
  /** 削除が成功した後に呼ぶ。一覧の再取得と通知は呼び出し側が行い、reject しない */
  onDeleted: () => Promise<void>
}

/** 在庫を削除する前の確認ダイアログ(#380)。通信中は閉じられない。 */
export function InventoryDeleteDialog({ item, onClose, onDeleted }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  const ref = useDialog(close, '[data-cancel]')

  const handleDelete = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiClient.delete(`/inventory-items/${item.id}`)
    } catch (err) {
      setError(getApiErrorMessage(err, '在庫の削除に失敗しました。時間をおいて再度お試しください'))
      setBusy(false)
      return
    }
    // ここから先は削除済み。再取得の失敗を削除失敗と混同して再送させない
    await onDeleted()
    onClose()
  }

  return <div className="modal-overlay inventory-modal-overlay">
    <div ref={ref} className="modal inventory-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-delete-title">
      <h2 id="inventory-delete-title">在庫の削除</h2>
      <p>「{item.name}」を削除しますか？ 買い物リストの該当項目も一緒に削除されます。この操作は取り消せません。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={handleDelete}>削除する</button>
        <button type="button" className="btn btn-secondary" data-cancel disabled={busy} onClick={close}>キャンセル</button>
      </div>
    </div>
  </div>
}
