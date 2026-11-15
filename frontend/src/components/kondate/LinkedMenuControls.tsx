import type { MenuEntry } from '../../api/kondateTypes'
import { useDialog } from '../../hooks/useDialog'
export function MenuMealConfirmation({entry,undo,busy,confirmBlocked,error,onClose,onConfirm}:{entry:MenuEntry;undo:boolean;busy:boolean;confirmBlocked:boolean;error:string;onClose:()=>void;onConfirm:()=>void}) {
 const close=()=>{if(!busy)onClose()}
 const ref=useDialog(close,'[data-meal-cancel]'),link=entry.inventoryLinkage!
 return <div className="modal-overlay" onClick={e=>{if(e.currentTarget===e.target)close()}}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="meal-confirm-title">
  <h2 id="meal-confirm-title">{undo?'食事を取り消す':'食事を記録'}</h2>
  <p>「{entry.recipeTitle}」{undo?'の食事を取り消しますか？':'を食べたことを記録しますか？'}</p>
  <p>{link.inventoryName??'削除された在庫'}：現在 {link.quantity??'—'}、{undo?'戻す数':'減らす数'} {undo ? (link.undoQuantity ?? '—') : link.remainingCount != null ? 1 : link.usageQuantity}</p>
  <p>{link.linkId === null ? '関連は解除されています。取消では在庫だけを戻し、料理の予定は復活させません。' : link.remainingCount != null ? '残り予定も1回分変わります。取消は直前の食事から順に戻します。' : '旧設定の食事量を使用します。'}</p>
  {error&&<p role="alert" className="error">{error}</p>}
  <div className="modal-actions"><button type="button" className="btn btn-primary" disabled={busy||confirmBlocked} onClick={onConfirm}>{undo?'食事を取り消して戻す':'食べたことを記録'}</button><button type="button" className="btn btn-secondary" data-meal-cancel disabled={busy} onClick={close}>キャンセル</button></div>
 </div></div>
}
export function LinkedMenuControls({entry,disabled,carryReady,onMeal,onCarry}:{entry:MenuEntry;disabled:boolean;carryReady:boolean;onMeal:(undo:boolean,button:HTMLButtonElement)=>void;onCarry:(enabled:boolean)=>void}) {
 const link=entry.inventoryLinkage!
 const planned = link.remainingCount != null
 const oldDto = link.remainingCount === undefined
 let reason=''
 if(link.unavailableReason==='inventory_deleted')reason='元の在庫は削除されています'
 else if(link.unavailableReason==='daily_consumption')reason='自動消費をOFFにしてから食事・取消を行ってください'
 else if(link.linkId === null)reason='関連は解除されています。取消は在庫だけに反映します'
 else if(link.unavailableReason==='recipe_deleted')reason='レシピ原本は削除されています'
 else if(link.unavailableReason==='link_disabled')reason='在庫との連携は停止中です。予定と持ち越し設定は保持されています'
 else if(!link.canConsume && planned && link.remainingCount === 0)reason='残り予定は0回です'
 else if(!link.canConsume && !link.canUndo)reason='今週以外、在庫不足、または在庫の上限により操作できません'
 return <div className="menu-inventory-controls">
  <p>{link.inventoryName??'削除された在庫'} · 在庫 {link.quantity??'—'} · {planned ? `残り予定 ${link.remainingCount}回` : `使用数 ${link.usageQuantity}`}</p>
  {link.memo && <p className="menu-plan-memo">{link.memo}</p>}
  <p>{link.mealState==='eaten'?'食事済みの記録があります':'未食'}</p>
  <div className="menu-inventory-actions">
  {planned ? <><button type="button" className="btn btn-secondary" disabled={disabled||!link.canConsume} onClick={e=>onMeal(false,e.currentTarget)}>食べた</button><button type="button" className="btn btn-secondary" disabled={disabled||!link.canUndo} onClick={e=>onMeal(true,e.currentTarget)}>取り消す</button></> : <button type="button" className="btn btn-secondary" disabled={disabled||!(link.mealState==='eaten'?link.canUndo:link.canConsume)} onClick={e=>onMeal(link.mealState==='eaten',e.currentTarget)}>{link.mealState==='eaten'?'取り消す':'食べた'}</button>}
  {oldDto && <label><input type="checkbox" checked={link.carryEnabled} disabled={disabled||!carryReady||link.inventoryItemId===null||(!link.carryEnabled&&(!link.quantity||!link.enabled||link.unavailableReason==='recipe_deleted'))} onChange={e=>onCarry(e.target.checked)}/>来週へ持ち越す</label>}</div>
  {reason&&<p>{reason}</p>}
  {!oldDto && link.linkId !== null && <p className="ui-page-sub">持ち越し：{link.carryEnabled?'オン':'オフ'}。予定回数・メモ・持ち越しは在庫の詳細編集でまとめて変更できます。</p>}
 </div>
}
