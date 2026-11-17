import type { FixedCost } from '../../api/kakeiboTypes'
import { useDialog } from '../../hooks/useDialog'
import type { HouseholdMember } from './SplitFields'

interface Props {
  fixedCost: FixedCost
  paymentSource: string
  members: HouseholdMember[]
  membersLoaded: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: (trigger: HTMLButtonElement) => void
  hidden?: boolean
}

export function FixedCostDetailModal({ fixedCost: cost, paymentSource, members, membersLoaded, onClose, onEdit, onDelete, hidden = false }: Props) {
  const ref = useDialog(onClose, '[data-close]')
  return <div className="modal-overlay" hidden={hidden} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="modal fixed-cost-modal" role="dialog" aria-modal="true" aria-labelledby="fixed-cost-detail-title">
      <div className="fixed-cost-titlebar">
        <h2 id="fixed-cost-detail-title">固定費詳細</h2>
        {cost.editable && <button type="button" className="btn btn-danger fixed-cost-delete-action" aria-label={`${cost.name}を削除`} onClick={(event) => onDelete(event.currentTarget)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
        </button>}
      </div>
      <dl>
        <dt>固定費名</dt><dd>{cost.name}</dd>
        <dt>金額</dt><dd>{cost.amount.toLocaleString('ja-JP')}円</dd>
        <dt>支払日</dt><dd>{cost.paymentDay}日</dd>
        <dt>公開範囲</dt><dd>{cost.personal ? '個人' : '世帯共有'}</dd>
        <dt>世帯合計対象</dt><dd>{cost.includeInHouseholdTotal ? '含める' : '含めない'}</dd>
        <dt>引き落とし元</dt><dd>{paymentSource}</dd>
        <dt>割り勘設定</dt><dd>{!cost.editable ? '非公開' : cost.splits.length === 0 ? 'なし' : <>
          <div>{cost.splitInputType === 'amount' ? '金額入力' : '％入力'}</div>
          {cost.splits.map((split) => <div key={split.debtorExternalId != null ? `external:${split.debtorExternalId}` : `member:${split.debtorUserId}`}>
            {split.debtorExternalId != null
              ? (split.debtorExternalName || '相手の名前を確認できません')
              : members.find((member) => member.userId === split.debtorUserId)?.displayName ?? (membersLoaded ? '世帯を退出したメンバー' : '相手の名前を確認できません')}
            ：{split.splitRatio}% / {split.amountDue}円
          </div>)}
        </>}</dd>
      </dl>
      <div className="modal-actions">
        {cost.editable && <>
          <button type="button" className="btn btn-primary" onClick={onEdit}>編集</button>
        </>}
        <button type="button" className="btn btn-secondary" data-close onClick={onClose}>閉じる</button>
      </div>
    </div>
  </div>
}

export function FixedCostDeleteModal({ name, busy, onClose, onDelete }: { name: string; busy: boolean; onClose: () => void; onDelete: () => void }) {
  const close = () => { if (!busy) onClose() }
  const ref = useDialog(close, '[data-cancel]')
  return <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal fixed-cost-modal" role="dialog" aria-modal="true" aria-labelledby="fixed-cost-delete-title">
      <h2 id="fixed-cost-delete-title">固定費を削除しますか？</h2>
      <p>「{name}」を削除します。この操作は取り消せません。</p>
      <p>今後の自動計上を停止します。固定費の割り勘設定は削除されますが、すでに計上された支出は残ります。</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onDelete}>削除する</button>
        <button type="button" className="btn btn-secondary" data-cancel disabled={busy} onClick={close}>キャンセル</button>
      </div>
    </div>
  </div>
}
