import { isAxiosError } from 'axios'
import { Fragment, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Category, InventoryItem, Store } from '../../api/zaikoTypes'
import { InventoryModal } from './InventoryModal'
import { InventoryDeleteDialog } from './InventoryDeleteDialog'
import { filterByKeyword } from '../../lib/keyword'

interface Props {
  inventory: InventoryItem[]
  categories: Category[]
  onCategoriesChange: (categories: Category[]) => void
  stores: Store[]
  onStoresChange: (stores: Store[]) => void
  onRefresh: () => Promise<void>
  onNotify: (message: string) => void
}

export function InventoryPanel({ inventory, categories, onCategoriesChange, stores, onStoresChange, onRefresh, onNotify }: Props) {
  const [selectedId, setSelectedId] = useState<number>()
  const [formOpen, setFormOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number>()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [quantityErrors, setQuantityErrors] = useState<Record<number, string>>({})
  const [uncertainIds, setUncertainIds] = useState<Set<number>>(new Set())
  const uncertain = useRef(new Set<number>())
  const uncertainMessage = '数量変更の結果を確認できません。重複を防ぐため、この品目の数量変更を停止しています。一覧を確認し、画面を再読み込みしてください。'
  const [steps, setSteps] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem>()
  const deleteOrigin = useRef<HTMLButtonElement | null>(null)
  const pending = useRef(false)
  const origin = useRef<HTMLButtonElement | null>(null)
  const register = useRef<HTMLButtonElement>(null)
  const selected = inventory.find((item) => item.id === selectedId)
  const inCategory = categoryId === '' ? inventory : inventory.filter(item => String(item.categoryId) === categoryId)
  const visible = filterByKeyword(inCategory, keyword, (item) => item.name)
  useEffect(() => {
    if (categoryId !== '' && !categories.some(category => String(category.id) === categoryId)) setCategoryId('')
  }, [categories, categoryId])
  const closeDelete = () => {
    setDeleteTarget(undefined)
    queueMicrotask(() => (deleteOrigin.current?.isConnected ? deleteOrigin.current : register.current)?.focus())
  }
  const focusRequested = useRef(false)
  const closeForm = () => { focusRequested.current = true; setSelectedId(undefined); setFormOpen(false) }
  useEffect(() => {
    if (!focusRequested.current || formOpen || busy) return
    focusRequested.current = false
    const target = origin.current?.isConnected ? origin.current : register.current
    if (target && !target.closest('[hidden], [inert]')) target.focus()
  }, [formOpen, busy])
  useEffect(() => {
    if (selectedId !== undefined && !selected) {
      setSelectedId(undefined)
      setFormOpen(false)
      register.current?.focus()
    }
  }, [selected, selectedId])

  const adjustQuantity = async (item: InventoryItem, delta: number, consumeDraft = false) => {
    if (pending.current || uncertain.current.has(item.id)) return
    pending.current = true
    setBusy(true)
    setQuantityErrors(previous => ({ ...previous, [item.id]: '' }))
    let success = false
    let unknown = false
    try {
      const { data } = await apiClient.patch<{ quantity: number }>(`/inventory-items/${item.id}/quantity`, { delta })
      if (!Number.isFinite(data?.quantity) || data.quantity < 0 || data.quantity > 99999.9 || Math.abs(data.quantity * 10 - Math.round(data.quantity * 10)) >= 1e-9) throw new Error('Invalid quantity response')
      success = true
      if (consumeDraft) setDrafts(previous => ({ ...previous, [item.id]: '' }))
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined
      if (status === 400 || status === 401) {
        const message = getApiErrorMessage(err, '在庫個数の更新に失敗しました')
        setQuantityErrors(previous => ({ ...previous, [item.id]: message }))
        onNotify(message)
      } else {
        unknown = true
        uncertain.current.add(item.id)
        setUncertainIds(new Set(uncertain.current))
        onNotify(uncertainMessage)
      }
    }
    try {
      if (success || unknown) await onRefresh()
    } catch {
      onNotify(success ? '在庫個数を更新しました。一覧の再取得に失敗しました' : '数量変更の結果を確認できません。一覧の再取得にも失敗しました。画面を再読み込みしてください。')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const adjustStep = (item: InventoryItem, sign: 1 | -1) => {
    const delta = sign * (steps[item.id] ?? 1)
    if (Math.round((item.quantity + delta) * 10) < 0) { onNotify('在庫個数は0未満にできません'); return }
    void adjustQuantity(item, delta)
  }
  const applyDraft = (item: InventoryItem) => {
    if (pending.current || uncertain.current.has(item.id)) return
    const value = (drafts[item.id] ?? '').trim()
    const delta = Number(value)
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(delta) || Math.abs(delta) > 99999.9 || Math.abs(delta * 10 - Math.round(delta * 10)) >= 1e-9) {
      setQuantityErrors(previous => ({ ...previous, [item.id]: '増減量は-99999.9〜99999.9、小数点第一位までで入力してください' }))
      return
    }
    void adjustQuantity(item, delta, true)
  }

  return <div className="panel" data-testid="inventory-panel">
    <div className="toolbar"><h2>在庫一覧</h2><button ref={register} type="button" className="btn btn-primary" onClick={() => { origin.current = register.current; setFormOpen(true) }}>在庫を登録</button></div>
    <div className="inventory-filters">
      <input type="search" className="zaiko-search" aria-label="キーワード検索" placeholder="キーワードで絞り込み" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      <label className="inventory-category-filter" htmlFor="inventory-filter-category">カテゴリーで絞り込み
        <select id="inventory-filter-category" value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          <option value="">すべて</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
    </div>
    <div className="inventory-list" aria-label="在庫一覧">
      <div className="inventory-row inventory-list-heading list-row-heading"><div className="inventory-list-grid"><span>品名</span><span>在庫数</span><span aria-hidden="true" /></div><span className="inventory-delete-spacer" aria-hidden="true" /></div>
      {inventory.length === 0 ? <p>在庫がありません</p> : visible.length === 0 ? <p>該当する品目がありません</p> : visible.map((item) => {
        const low = item.quantity <= item.threshold
        const stopped = uncertainIds.has(item.id)
        const expanded = expandedId === item.id
        return <Fragment key={item.id}>
          <div className="inventory-row">
            <button type="button" className="list-row-button inventory-list-grid" aria-label={`${item.name}の詳細`} aria-describedby={`inventory-summary-${item.id}`}
              aria-expanded={expanded} aria-controls={`inventory-quantity-${item.id}`} disabled={busy}
              onClick={() => setExpandedId(expanded ? undefined : item.id)}>
              <span>{item.name}</span><span className="inventory-list-quantity">{item.quantity.toFixed(1)}</span><span className="inventory-low-stock" aria-hidden="true">{low ? '！' : ''}</span>
            </button>
            <span id={`inventory-summary-${item.id}`} className="sr-only">在庫数 {item.quantity.toFixed(1)}{low ? ' 在庫が閾値以下' : ''}</span>
            <button type="button" className="inventory-delete-button" disabled={busy} aria-label={`${item.name}を削除`} onClick={(event) => { deleteOrigin.current = event.currentTarget; setDeleteTarget(item) }}>×</button>
          </div>
          {expanded && <section id={`inventory-quantity-${item.id}`} className="inventory-expanded" role="region" aria-label={`${item.name}の数量変更`} hidden={formOpen}>
            <div className="inventory-inline-actions">
              <button type="button" className="btn btn-secondary" disabled={busy || stopped} aria-label={`${item.name}を増やす`} onClick={() => adjustStep(item, 1)}>＋</button>
              <button type="button" className="btn btn-secondary" disabled={busy || stopped} aria-label={`${item.name}を減らす`} onClick={() => adjustStep(item, -1)}>－</button>
              <div className="inventory-step-options" role="group" aria-label="増減幅"><span>増減幅</span>{[1, 0.1].map(value => <button key={value} type="button" className="btn btn-secondary" aria-pressed={(steps[item.id] ?? 1) === value} disabled={busy || stopped} onClick={() => setSteps(previous => ({ ...previous, [item.id]: value }))}>{value}</button>)}</div>
            </div>
            <form className="inventory-delta-form" noValidate onSubmit={event => { event.preventDefault(); applyDraft(item) }}>
              <label htmlFor={`inventory-delta-${item.id}`}>増減量</label>
              <div><input id={`inventory-delta-${item.id}`} type="text" inputMode="text" value={drafts[item.id] ?? ''} disabled={busy || stopped}
                aria-describedby={`inventory-delta-hint-${item.id}`} aria-invalid={Boolean(quantityErrors[item.id])}
                onChange={event => setDrafts(previous => ({ ...previous, [item.id]: event.target.value }))} />
                <button type="submit" className="btn btn-primary" disabled={busy || stopped}>適用</button></div>
              <p id={`inventory-delta-hint-${item.id}`} className="hint">正の数は加算、負の数は減算します。適用後は取り消せません。</p>
            </form>
            {stopped ? <p className="error" role="alert">{uncertainMessage}</p> : quantityErrors[item.id] && <p className="error" role="alert">{quantityErrors[item.id]}</p>}
            <button type="button" className="btn btn-secondary inventory-details-button" disabled={busy} aria-label={`${item.name}の詳細設定`} onClick={event => { origin.current = event.currentTarget; setSelectedId(item.id); setFormOpen(true) }}>詳細設定</button>
          </section>}
        </Fragment>
      })}
    </div>
    {deleteTarget && <InventoryDeleteDialog item={deleteTarget} onClose={closeDelete} onDeleted={async () => {
      // 削除は確定済み。再取得のcommit前に残る旧行へフォーカスを戻さない。
      deleteOrigin.current = null
      try { await onRefresh(); onNotify('在庫を削除しました') }
      catch { onNotify('削除しました。一覧の再取得に失敗しました') }
    }} />}
    {formOpen && <InventoryModal item={selected} categories={categories} onCategoriesChange={onCategoriesChange} stores={stores} onStoresChange={onStoresChange}
      busy={busy} quantityStopped={selected ? uncertainIds.has(selected.id) : false} quantityNotice={selected && uncertainIds.has(selected.id) ? uncertainMessage : undefined}
      step={selected ? steps[selected.id] ?? 1 : 1}
      onStep={step => { if (selected) setSteps(previous => ({ ...previous, [selected.id]: step })) }}
      onAdjust={sign => { if (selected) adjustStep(selected, sign) }} onClose={closeForm} onSaved={async () => {
        pending.current = true
        setBusy(true)
        const message = selected ? '在庫を編集しました' : '在庫を登録しました'
        try { await onRefresh(); onNotify(message) }
        catch { onNotify(`${message}。一覧の再取得に失敗しました`) }
        finally { pending.current = false; setBusy(false); closeForm() }
      }} />}
  </div>
}
