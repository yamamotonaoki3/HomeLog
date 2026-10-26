import { useEffect, useRef, useState } from 'react'
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
  const restoreFocus =() => (origin.current?.isConnected ? origin.current : register.current)?.focus()
  const closeForm = () => { setSelectedId(undefined); setFormOpen(false); restoreFocus() }
  useEffect(() => {
    if (selectedId !== undefined && !selected) {
      setSelectedId(undefined)
      setFormOpen(false)
      register.current?.focus()
    }
  }, [selected, selectedId])

  const adjustQuantity = async (item: InventoryItem, sign: 1 | -1) => {
    if (pending.current) return
    const delta = sign * (steps[item.id] ?? 1)
    if (Math.round((item.quantity + delta) * 10) < 0) { onNotify('在庫個数は0未満にできません'); return }
    pending.current = true
    setBusy(true)
    try {
      await apiClient.patch(`/inventory-items/${item.id}/quantity`, { delta })
      await onRefresh()
    } catch (err) { onNotify(getApiErrorMessage(err, '在庫個数の更新に失敗しました')) }
    finally { pending.current = false; setBusy(false) }
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
      <div className="inventory-row inventory-list-heading list-row-heading"><div className="inventory-list-grid"><span>品名</span><span>在庫数</span><span>閾値</span></div><span className="inventory-delete-spacer" aria-hidden="true" /></div>
      {inventory.length === 0 ? <p>在庫がありません</p> : visible.length === 0 ? <p>該当する品目がありません</p> : visible.map((item) =>
        <div key={item.id} className="inventory-row">
          <button type="button" className="list-row-button inventory-list-grid" aria-label={`${item.name}の詳細`} onClick={(event) => { origin.current = event.currentTarget; setSelectedId(item.id); setFormOpen(true) }}>
            <span>{item.name}</span><span className="inventory-list-quantity">{item.quantity.toFixed(1)}</span><span>{item.threshold.toFixed(1)}</span>
          </button>
          <button type="button" className="inventory-delete-button" aria-label={`${item.name}を削除`} onClick={(event) => { deleteOrigin.current = event.currentTarget; setDeleteTarget(item) }}>×</button>
        </div>)}
    </div>
    {deleteTarget && <InventoryDeleteDialog item={deleteTarget} onClose={closeDelete} onDeleted={async () => {
      try {
        await onRefresh()
        onNotify('在庫を削除しました')
      } catch {
        onNotify('削除しました。一覧の再取得に失敗しました')
      }
    }} />}
    {formOpen && <InventoryModal item={selected} categories={categories} onCategoriesChange={onCategoriesChange} stores={stores} onStoresChange={onStoresChange} busy={busy} step={selected ? steps[selected.id] ?? 1 : 1} onStep={(step) => { if (selected) setSteps((previous) => ({ ...previous, [selected.id]: step })) }} onAdjust={(sign) => { if (selected) void adjustQuantity(selected, sign) }} onClose={closeForm} onSaved={async () => {
      pending.current = true
      setBusy(true)
      const message = selected ? '在庫を編集しました' : '在庫を登録しました'
      try {
        await onRefresh()
        onNotify(message)
      } catch {
        onNotify(`${message}。一覧の再取得に失敗しました`)
      } finally {
        pending.current = false
        setBusy(false)
        closeForm()
      }
    }} />}
  </div>
}
