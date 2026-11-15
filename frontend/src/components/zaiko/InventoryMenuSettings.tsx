import { useEffect, useRef, useState } from 'react'
import type { InventoryMenuLink, InventoryMenuLinkUpdate } from '../../api/zaikoTypes'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import { MenuTitle } from '../kondate/MenuTitle'
interface Props {
  link: InventoryMenuLink
  quantity: number
  autoConsumptionEnabled: boolean
  disabled: boolean
  onSave: (id: number, body: InventoryMenuLinkUpdate) => Promise<InventoryMenuLink>
  onBusy: (busy: boolean) => void
}
export function InventoryMenuSettings({ link, quantity, autoConsumptionEnabled, disabled, onSave, onBusy }: Props) {
  const [usage, setUsage] = useState(String(link.usageQuantity)), [enabled, setEnabled] = useState(link.enabled), [carry, setCarry] = useState(link.carryEnabled), [error, setError] = useState(''), [message, setMessage] = useState('')
  const pending = useRef(false)
  useEffect(() => { setUsage(String(link.usageQuantity)); setEnabled(link.enabled); setCarry(link.carryEnabled); setError('') }, [link.revision, link.usageQuantity, link.enabled, link.carryEnabled])
  const save = async () => {
    if (pending.current || disabled) return
    const value = Number(usage)
    if (!usage.trim() || !Number.isFinite(value) || value < 0.1 || value > 99999.9 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-7) { setError('使用数は0.1〜99999.9、小数点第一位までで入力してください'); return }
    if (quantity <= 0 && ((!link.enabled && enabled) || (!link.carryEnabled && carry))) { setError('在庫を補充してから再開してください'); return }
    pending.current = true; onBusy(true); setError(''); setMessage('')
    try { await onSave(link.id, { expectedRevision: link.revision, usageQuantity: value, enabled, carryEnabled: carry }); setMessage('連携設定を保存しました') }
    catch (err) { setError(getApiErrorMessage(err, '連携設定の結果を確認できません。一覧を再取得してから確認してください')) }
    finally { pending.current = false; onBusy(false) }
  }
  return <section className="ui-card inventory-menu-draft" aria-label={`${link.recipeTitle}の連携設定`}>
    <MenuTitle text={link.recipeTitle} />
    <label>{link.recipeTitle}の連携使用数<input type="number" inputMode="decimal" min="0.1" max="99999.9" step="0.1" value={usage} disabled={disabled} onChange={event => setUsage(event.target.value)} /></label>
    <label className="inventory-menu-check"><input type="checkbox" checked={enabled} disabled={disabled || (!enabled && (quantity <= 0 || autoConsumptionEnabled || link.recipeId === null))} onChange={event => { setEnabled(event.target.checked); if (!event.target.checked) setCarry(false) }} />{link.recipeTitle}と献立を連携する</label>
    <label className="inventory-menu-check"><input type="checkbox" checked={carry} disabled={disabled || !enabled || (!carry && quantity <= 0)} onChange={event => setCarry(event.target.checked)} />{link.recipeTitle}を翌週へ持ち越す</label>
    {quantity <= 0 && <p className="hint">在庫を補充してから再開してください</p>}
    {link.recipeId === null && <p className="hint">原本のレシピは削除されています。</p>}
    <p className="hint">在庫が0になると持ち越しは停止します。補充や食事の取消では再開しません。使用数の変更は今週の食事済み記録には反映しません。</p>
    <button type="button" className="btn btn-secondary" aria-label={`${link.recipeTitle}の連携設定を保存`} disabled={disabled} onClick={() => void save()}>連携設定を保存</button>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
