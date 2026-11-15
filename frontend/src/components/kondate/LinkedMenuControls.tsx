import type { MenuEntry } from '../../api/kondateTypes'
import { useDialog } from '../../hooks/useDialog'
export function MenuMealConfirmation({entry,undo,busy,confirmBlocked,error,onClose,onConfirm}:{entry:MenuEntry;undo:boolean;busy:boolean;confirmBlocked:boolean;error:string;onClose:()=>void;onConfirm:()=>void}) {
 const close=()=>{if(!busy)onClose()}
 const ref=useDialog(close,'[data-meal-cancel]'),link=entry.inventoryLinkage!
 return <div className="modal-overlay" onClick={e=>{if(e.currentTarget===e.target)close()}}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="meal-confirm-title">
  <h2 id="meal-confirm-title">{undo?'食事を取り消す':'食事を記録'}</h2>
  <p>「{entry.recipeTitle}」{undo?'の食事を取り消しますか？':'を食べたことを記録しますか？'}</p>
  <p>{link.inventoryName??'削除された在庫'}：現在 {link.quantity??'—'}、{undo?'戻す数':'減らす数'} {link.usageQuantity}</p>
  <p>在庫が0になると持ち越しは停止します。補充や取り消しで自動再開しません。</p>
  {error&&<p role="alert" className="error">{error}</p>}
  <div className="modal-actions"><button type="button" className="btn btn-primary" disabled={busy||confirmBlocked} onClick={onConfirm}>{undo?'食事を取り消して戻す':'食べたことを記録'}</button><button type="button" className="btn btn-secondary" data-meal-cancel disabled={busy} onClick={close}>キャンセル</button></div>
 </div></div>
}
export function LinkedMenuControls({entry,disabled,carryReady,onMeal,onCarry}:{entry:MenuEntry;disabled:boolean;carryReady:boolean;onMeal:(undo:boolean,button:HTMLButtonElement)=>void;onCarry:(enabled:boolean)=>void}) {
 const link=entry.inventoryLinkage!
 let reason=''
 if(link.unavailableReason==='inventory_deleted')reason='元の在庫は削除されています'
 else if(link.mealState==='eaten'&&!link.canUndo)reason='今週以外、または在庫の上限を超えるため取り消せません'
 else if(link.mealState==='uneaten'&&!link.canConsume)reason=link.unavailableReason==='recipe_deleted'?'レシピ原本は削除されています':link.unavailableReason==='link_disabled'?'在庫との連携は停止中です':link.unavailableReason==='daily_consumption'?'日次消費が有効です':link.quantity!==null&&link.quantity<link.usageQuantity?'在庫が不足しています':'今週の献立だけ食事を記録できます'
 return <div className="menu-inventory-controls">
  <p>{link.inventoryName??'削除された在庫'} · 在庫 {link.quantity??'—'} · 使用数 {link.usageQuantity}</p>
  <p>{link.mealState==='eaten'?'食事済み':'未食'}</p>
  <div className="menu-inventory-actions"><button type="button" className="btn btn-secondary" disabled={disabled||!(link.mealState==='eaten'?link.canUndo:link.canConsume)} onClick={e=>onMeal(link.mealState==='eaten',e.currentTarget)}>{link.mealState==='eaten'?'取り消す':'食べた'}</button>
  <label><input type="checkbox" checked={link.carryEnabled} disabled={disabled||!carryReady||link.inventoryItemId===null||(!link.carryEnabled&&(!link.quantity||!link.enabled||link.unavailableReason==='recipe_deleted'))} onChange={e=>onCarry(e.target.checked)}/>来週へ持ち越す</label></div>
  {reason&&<p>{reason}</p>}
  {!link.carryEnabled&&link.quantity===0&&<p>在庫を補充してから再開してください</p>}
  <p className="ui-page-sub">食事済みは今週だけ表示します。来週への持ち越しは残りの在庫がある場合だけです。</p>
 </div>
}
