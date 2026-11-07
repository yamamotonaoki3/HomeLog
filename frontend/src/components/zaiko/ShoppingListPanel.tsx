import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { filterByKeyword } from '../../lib/keyword'
import { apiClient } from '../../api/client'
import { captureCredentials } from '../../api/shoppingPurchases'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import { parseQuantity, type PurchaseLine } from '../../lib/shoppingPending'
import { useShoppingPurchases } from '../../hooks/useShoppingPurchases'
import { validPrice, PRICE_ERROR } from './price'
import { ShoppingListDetailModal } from './ShoppingListDetailModal'
import { ShoppingPurchaseConfirmDialog } from './ShoppingPurchaseConfirmDialog'
import type { Category, InventoryItem, ShoppingListItem, ShoppingSort, Store } from '../../api/zaikoTypes'
interface Props {
  shopping: ShoppingListItem[]; inventory: InventoryItem[]; categories: Category[]; stores: Store[]; sort: ShoppingSort
  onSortChange: (sort: ShoppingSort) => void; onRefresh: () => Promise<void>; onNotify: (message: string) => void
  actorUserId?: number; active?: boolean
}
interface RowDraft { checked: boolean; actualText: string; checkedRevision: number; plannedText?: string; plannedDirty?: boolean; error?: string }
type ConfirmLine = PurchaseLine & { name: string }
export function ShoppingListPanel({ shopping, inventory, categories, stores, sort, onSortChange, onRefresh, onNotify, actorUserId, active = true }: Props) {
  const [keyword, setKeyword] = useState(''), [addFormOpen, setAddFormOpen] = useState(false), [addItemId, setAddItemId] = useState(''), [addPrice, setAddPrice] = useState('')
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({})
  const [completed, setCompleted] = useState<Record<number, number>>({})
  const [overrides, setOverrides] = useState<Record<number, { plannedQuantity: number; purchaseRevision: number }>>({})
  const [selectedId, setSelectedId] = useState<number>(), [confirmLines, setConfirmLines] = useState<ConfirmLine[] | null>(null)
  const [savingId, setSavingId] = useState<number>(), [mutation, setMutation] = useState(false), [refreshing, setRefreshing] = useState(false)
  const mutationPending = useRef(false), origin = useRef<HTMLButtonElement | null>(null), addButton = useRef<HTMLButtonElement>(null), reflectButton = useRef<HTMLButtonElement>(null)
  const bar = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ bottom: 0, height: 80 })
  const deletionFocus = useRef(false)
  useEffect(() => { if (!mutation && deletionFocus.current) { deletionFocus.current = false; addButton.current?.focus() } }, [mutation])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const purchase = useShoppingPurchases({
    actorUserId,
    onSuccess: async (body, result) => {
      // The response contains only the purchased rows' remaining quantity/revision.
      // Preserve row metadata and never rebase a newer GET or planned-save result.
      setOverrides(previous => {
        const next = { ...previous }
        for (const remaining of result.remainingShoppingListItems) {
          const expected = body.items.find(line => line.id === remaining.id)?.expectedPurchaseRevision
          const item = shopping.find(row => row.id === remaining.id)
          const currentRevision = Math.max(item?.purchaseRevision ?? -1, previous[remaining.id]?.purchaseRevision ?? -1)
          if (item && currentRevision === expected) next[remaining.id] = { plannedQuantity: remaining.plannedQuantity, purchaseRevision: remaining.purchaseRevision }
        }
        return next
      })
      setCompleted(previous => {
        const next = { ...previous }
        for (const id of result.removedShoppingListItemIds) {
          const expected = body.items.find(line => line.id === id)?.expectedPurchaseRevision
          const item = shopping.find(row => row.id === id)
          const currentRevision = Math.max(item?.purchaseRevision ?? -1, overrides[id]?.purchaseRevision ?? -1)
          if (item && currentRevision === expected) next[id] = expected
        }
        return next
      })
      setDrafts(previous => { const next = { ...previous }; for (const line of body.items) { const draft = next[line.id]; if (draft?.checkedRevision === line.expectedPurchaseRevision && parseQuantity(draft.actualText) === line.purchasedQuantity) next[line.id] = { ...draft, checked: false, actualText: '', plannedText: draft.plannedDirty ? draft.plannedText : undefined, error: undefined } }; return next })
      setConfirmLines(null)
      await onRefresh()
    },
    onNotApplied: async () => { setConfirmLines(null); await onRefresh() },
    onDetached: () => { setDrafts({}); setOverrides({}); setCompleted({}); setSelectedId(undefined); setConfirmLines(null); setAddFormOpen(false); setAddItemId(''); setAddPrice('') },
  })
  const detached = purchase.status === 'detached'
  const sending = purchase.status === 'sending' || purchase.status === 'refreshing'
  const checking = purchase.status === 'checking'
  const rows = shopping.map(item => overrides[item.id] && overrides[item.id].purchaseRevision > item.purchaseRevision ? { ...item, ...overrides[item.id] } : item).filter(item => completed[item.id] !== item.purchaseRevision)
  const selected = rows.find(item => item.id === selectedId)
  const draftOf = (item: ShoppingListItem): RowDraft => drafts[item.id] ?? { checked: false, actualText: '', checkedRevision: item.purchaseRevision }
  const plannedTextOf = (item: ShoppingListItem): string => draftOf(item).plannedDirty ? (draftOf(item).plannedText ?? '') : String(item.plannedQuantity)
  const updateDraft = (item: ShoppingListItem, patch: Partial<RowDraft>) => setDrafts(prev => ({ ...prev, [item.id]: { ...draftOf(item), ...prev[item.id], ...patch } }))
  const closeDetail = () => { setSelectedId(undefined); (origin.current?.isConnected ? origin.current : addButton.current)?.focus() }
  const closeConfirm = () => { setConfirmLines(null); reflectButton.current?.focus() }
  useEffect(() => { if (selectedId !== undefined && !shopping.some(item => item.id === selectedId)) { addButton.current?.focus() } }, [shopping, selectedId])
  useEffect(() => {
    if (!active) return
    const measure = () => {
      const nav = document.querySelector('.primary-nav')?.getBoundingClientRect().height ?? 0
      const viewport = window.visualViewport
      const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
      setPosition({ bottom: Math.max(nav, keyboard), height: bar.current?.getBoundingClientRect().height || 80 })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    const nav = document.querySelector('.primary-nav'); if (nav) observer?.observe(nav); if (bar.current) observer?.observe(bar.current)
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure) }
  }, [active, detached])
  const inventoryOf = (id: number) => inventory.find(item => item.id === id)
  const storeName = (id: number | null | undefined) => stores.find(store => store.id === id)?.name ?? '店舗未指定'
  const stockText = (id: number) => inventoryOf(id)?.quantity.toFixed(1) ?? '－'
  const targetPending = (id: number) => purchase.pending?.items.some(line => line.id === id) ?? false
  const locked = (id: number) => sending || checking || mutation || savingId === id || targetPending(id) || detached
  const checked = rows.filter(item => draftOf(item).checked)
  const stale = checked.some(item => draftOf(item).checkedRevision !== item.purchaseRevision)
  const invalid = checked.some(item => parseQuantity(draftOf(item).actualText) === null)
  const targets: ConfirmLine[] = checked.flatMap(item => { const value = parseQuantity(draftOf(item).actualText); return value !== null && value > 0 ? [{ id: item.id, name: item.name, purchasedQuantity: value, expectedPurchaseRevision: draftOf(item).checkedRevision }] : [] })
  const canConfirm = !sending && !checking && !mutation && savingId === undefined && !purchase.pending && !stale && !invalid && targets.length > 0 && ['ready', 'notApplied'].includes(purchase.status)
  const identityValid = (snapshot: ReturnType<typeof captureCredentials>) => mounted.current && !!snapshot && captureCredentials()?.refreshToken === snapshot.refreshToken
  const handleManualAdd = async () => {
    if (mutationPending.current || sending || checking || detached) return
    if (!validPrice(addPrice)) { onNotify(PRICE_ERROR); return } if (!addItemId) return
    const snapshot = captureCredentials(); if (!snapshot) { purchase.detach(); return }
    mutationPending.current = true; setMutation(true)
    try {
      await apiClient.post('/shopping-list-items', { inventoryItemId: Number(addItemId), ...(addPrice.trim() === '' ? {} : { price: Number(addPrice) }) })
      if (!identityValid(snapshot)) { purchase.detach(); return }
      setAddFormOpen(false); setAddItemId(''); setAddPrice('')
      try { await onRefresh(); if (!identityValid(snapshot)) purchase.detach() } catch { if (identityValid(snapshot)) onNotify('品目を追加しました。一覧の再取得に失敗しました') }
    } catch (error) { if (identityValid(snapshot)) onNotify(getApiErrorMessage(error, '買い物リストへの追加に失敗しました')); else purchase.detach() }
    finally { mutationPending.current = false; if (mounted.current) setMutation(false) }
  }
  const handleDelete = async (item: ShoppingListItem) => {
    if (mutationPending.current || locked(item.id)) return
    const snapshot = captureCredentials(); if (!snapshot) { purchase.detach(); return }
    mutationPending.current = true; setMutation(true)
    try {
      await apiClient.delete('/shopping-list-items/' + item.id)
      if (!identityValid(snapshot)) { purchase.detach(); return }
      setDrafts(prev => { const next = { ...prev }; delete next[item.id]; return next }); deletionFocus.current = true; setSelectedId(undefined)
      try { await onRefresh(); if (!identityValid(snapshot)) purchase.detach() } catch { if (identityValid(snapshot)) onNotify('削除しました。一覧の再取得に失敗しました') }
    } catch (error) { if (identityValid(snapshot)) onNotify(getApiErrorMessage(error, '買い物リストからの削除に失敗しました')); else purchase.detach() }
    finally { mutationPending.current = false; if (mounted.current) setMutation(false) }
  }
  const savePlanned = async (item: ShoppingListItem) => {
    if (mutationPending.current || locked(item.id)) return
    const value = parseQuantity(plannedTextOf(item), 0.1)
    if (value === null) { updateDraft(item, { error: '予定数は0.1〜99999.9、小数第一位までで入力してください' }); return }
    const snapshot = captureCredentials(); if (!snapshot) { purchase.detach(); return }
    mutationPending.current = true; setSavingId(item.id); updateDraft(item, { error: undefined })
    try {
      const response = await apiClient.patch<{ id: number; plannedQuantity: number; purchaseRevision: number }>('/shopping-list-items/' + item.id, { plannedQuantity: value, expectedPurchaseRevision: item.purchaseRevision })
      if (!identityValid(snapshot)) { purchase.detach(); return }
      const result = response.data
      if (result.id !== item.id || result.plannedQuantity !== value || result.purchaseRevision !== item.purchaseRevision + 1) throw new Error('予定数の保存結果を確認できません。一覧を再取得してください')
      setOverrides(prev => ({ ...prev, [item.id]: { plannedQuantity: result.plannedQuantity, purchaseRevision: result.purchaseRevision } }))
      setDrafts(prev => { const old = prev[item.id] ?? draftOf(item); return { ...prev, [item.id]: { ...old, plannedText: String(result.plannedQuantity), plannedDirty: false, checkedRevision: old.checkedRevision === item.purchaseRevision ? result.purchaseRevision : old.checkedRevision, error: undefined } } })
    } catch (error) { if (identityValid(snapshot)) updateDraft(item, { error: getApiErrorMessage(error, '予定数を保存できませんでした。一覧を再取得して確認してください') }); else purchase.detach() }
    finally { mutationPending.current = false; if (mounted.current) setSavingId(undefined) }
  }
  const retryRefresh = async () => {
    if (refreshing) return
    const snapshot = captureCredentials(); if (!snapshot) { purchase.detach(); return }
    setRefreshing(true)
    try { await onRefresh(); if (!identityValid(snapshot)) purchase.detach(); else { purchase.acknowledgeRefresh(); onNotify('一覧を再取得しました') } }
    catch { if (identityValid(snapshot)) onNotify('一覧の再取得に失敗しました'); else purchase.detach() }
    finally { if (mounted.current) setRefreshing(false) }
  }
  const visible = filterByKeyword(rows, keyword, item => item.name)
  const groups = new Map<string, ShoppingListItem[]>()
  for (const item of visible) { const name = storeName(inventoryOf(item.inventoryItemId)?.storeId); groups.set(name, [...(groups.get(name) ?? []), item]) }
  return <div className="panel shopping-panel" data-testid="shopping-panel" style={{ '--shopping-bar-height': position.height + 'px', '--shopping-bar-bottom': position.bottom + 'px' } as CSSProperties}>
    <div className="toolbar">
      <h2>買い物リスト</h2>
      <button ref={addButton} type="button" className="btn btn-secondary" disabled={checking || sending || detached || mutation} onClick={() => setAddFormOpen(open => !open)}>品目を追加</button>
      <select aria-label="並び替え" value={sort} disabled={detached} onChange={e => onSortChange(e.target.value as ShoppingSort)}>
        <option value="name">あいうえお順</option>
        <option value="category">カテゴリー順</option>
        <option value="store">買う店順</option>
      </select>
    </div>
    {purchase.message && <p role="status" className="shopping-status">{purchase.message}</p>}
    {checking && <p role="status">本人と世帯を確認中…</p>}
    {purchase.pending && <div className="shopping-recovery">
      <p>未確認の購入は元の内容で確認します。未反映の場合は、この操作で購入を実行します。</p>
      <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void purchase.recover()}>前回の購入結果を確認</button>
    </div>}
    {['blocked', 'detached'].includes(purchase.status) && <button type="button" className="btn btn-secondary" onClick={() => void purchase.recheck()}>本人と世帯を再確認</button>}
    {['refreshFailed', 'notApplied', 'notAppliedRefreshFailed'].includes(purchase.status) && <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={() => void retryRefresh()}>一覧を再取得</button>}
    {!detached && <>
      {addFormOpen && <div className="inline-form shopping-add-form">
        <select aria-label="追加する品目" value={addItemId} disabled={mutation} onChange={e => { setAddItemId(e.target.value); const price = inventoryOf(Number(e.target.value))?.price; setAddPrice(price == null ? '' : String(price)) }}>
          <option value="">選択してください</option>{inventory.map(item =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <label htmlFor="shopping-price">値段（円・任意）</label>
        <input id="shopping-price" type="text" inputMode="numeric" value={addPrice} disabled={mutation} onChange={e => setAddPrice(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={mutation} onClick={() => void handleManualAdd()}>追加</button>
      </div>}
      <input type="search" className="zaiko-search" aria-label="キーワード検索" placeholder="キーワードで絞り込み" value={keyword} onChange={e => setKeyword(e.target.value)} />
      {stale && <p role="alert">予定が変更されています。最新の予定数を確認し、チェックを付け直してください。</p>}
      {invalid && <p role="alert">実購入数は0〜99999.9、小数第一位までで入力してください。</p>}
      <div aria-label="買い物リスト一覧">{rows.length === 0 ? <p>買い物リストは空です</p> : visible.length === 0 ? <p>該当する品目がありません</p> : [...groups].map(([name, items]) =>
        <section key={name} aria-label={name + 'の買い物'} className="shopping-store-group">
          <h3>{name}</h3>{items.map(item => {
const draft = draftOf(item); return <div key={item.id} className="shopping-row">
              <label className="shopping-checkbox">
                <input type="checkbox" aria-label={item.name + 'を購入済みにする'} checked={draft.checked} disabled={locked(item.id)} onChange={e => updateDraft(item, { checked: e.target.checked, actualText: e.target.checked ? String(item.plannedQuantity) : draft.actualText, checkedRevision: item.purchaseRevision, error: undefined })} />
              </label>
              <button type="button" className="list-row-button shopping-item-button" aria-label={item.name + 'の詳細'} onClick={e => { origin.current = e.currentTarget; setSelectedId(item.id) }}>
                <span className="shopping-item-name">{item.name}</span>
                <span className="shopping-item-quantities">
                  <span>予定 {item.plannedQuantity}</span>
                  <span>在庫 {stockText(item.inventoryItemId)}</span>{draft.checked && <span>実購入 {draft.actualText || '未入力'}</span>}</span>
              </button>
            </div>
})}</section>)}</div>
    </>}
    {active && !detached && selected && !confirmLines && <ShoppingListDetailModal item={selected} category={categories.find(c => c.id === inventoryOf(selected.inventoryItemId)?.categoryId)?.name ?? ''} store={storeName(inventoryOf(selected.inventoryItemId)?.storeId) === '店舗未指定' ? '' : storeName(inventoryOf(selected.inventoryItemId)?.storeId)} stock={stockText(selected.inventoryItemId)} plannedText={plannedTextOf(selected)} actualText={draftOf(selected).actualText} checked={draftOf(selected).checked} busy={locked(selected.id)} saving={savingId === selected.id} error={draftOf(selected).error ?? ''} onPlanned={text => updateDraft(selected, { plannedText: text, plannedDirty: true, error: undefined })} onActual={text => updateDraft(selected, { actualText: text, error: undefined })} onSavePlanned={() => void savePlanned(selected)} onDelete={() => void handleDelete(selected)} onClose={closeDetail} />}
    {active && !detached && confirmLines && <ShoppingPurchaseConfirmDialog lines={confirmLines} busy={sending || !canConfirm} onClose={closeConfirm} onConfirm={() => { if (!canConfirm) return; const lines = confirmLines.map(({ id, purchasedQuantity, expectedPurchaseRevision }) => ({ id, purchasedQuantity, expectedPurchaseRevision })); setConfirmLines(null); void purchase.confirm(lines) }} />}
    {active && !detached && <div ref={bar} className="shopping-purchase-bar">
      <span>{targets.length}品目を反映</span>
      <button ref={reflectButton} type="button" className="btn btn-primary" disabled={!canConfirm} onClick={() => { if (canConfirm) setConfirmLines(targets.map(line => ({ ...line }))) }}>購入を反映</button>
    </div>}
  </div>
}
